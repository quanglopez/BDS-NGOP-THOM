// Pipeline Price Intelligence — orchestrate: scope -> crawl -> lọc -> thống kê ->
// chọn comparable -> snapshot. MọI I/O đi qua interface để test không cần DB/mạng.

import { haversineKm } from "@/lib/geo/distance";
import { calcPpm2, computeStats, confidenceFrom, differencePercent, filterSample } from "./stats";
import { detectCategoryCode, resolveScope, type WardIndex } from "./scope";
import type { GeoResolver } from "./geo-resolver";
import { PricePipelineError } from "./errors";
import type { MarketGateway, RawMarketAd } from "./gateway";
import {
  MARKET_SOURCE,
  MIN_SAMPLE_SIZE,
  PRICE_INTELLIGENCE_VERSION,
  type NormalizedListing,
  type PriceComparable,
  type PriceIntelligence,
  type PriceScope,
  type PriceStatsRow,
} from "./types";

// Ngân sách crawl: trần cứng để không kéo dài thời gian chờ của user.
const MAX_GATEWAY_CALLS = 18;
const MAX_LISTINGS = 12 * 50;

export const REASON_NO_CATEGORY =
  "Chưa xác định được loại bất động sản để tạo nhóm tham chiếu phù hợp.";
export const REASON_NO_SCOPE =
  "Chưa xác định được khu vực để tạo nhóm tin tham chiếu phù hợp.";
export const REASON_NO_SAMPLE = "Chưa đủ dữ liệu tham chiếu cho khu vực này.";

export interface MarketListingRepo {
  /** Ghi nhiều tin, dedupe theo (source, external_id), giữ first_seen_at. */
  upsertMany(listings: NormalizedListing[]): Promise<void>;
  /** Tra mã quận từ dữ liệu đã crawl — KHÔNG gọi gateway. */
  findAreaV2(areaName: string, regionName: string | null): { areaV2: number; areaName: string } | null;
  /** Tra mã tỉnh từ dữ liệu đã crawl. Riêng vì findAreaV2 là tra theo cặp (tên, tỉnh). */
  findRegionV2(regionName: string | null): number | null;
  /** Tin cùng scope, đã lọc sơ bộ theo tỉnh/quận/loại. */
  listByGeo(args: {
    regionV2: number | null;
    areaV2: number | null;
    categoryCode: number;
  }): Promise<NormalizedListing[]>;
}

export interface PriceStatsRepo {
  get(scopeKey: string, statDate: string): Promise<PriceStatsRow | null>;
  /** Claim khoá bằng PK (scope_key, stat_date). true = mình được phép crawl. */
  claim(args: {
    scopeKey: string;
    statDate: string;
    scope: PriceScope;
    source: string;
  }): Promise<boolean>;
  /**
   * Bỏ dòng claim khi crawl hỏNG. Bắt buộc: dòng claim là placeholder
   * `sample_size=0`, mà `get()` coi bất kỳ dòng nào có mặt là dữ liệu thật.
   * Giữ lại sau một lần crawl hỏng -> cả ngày đọc nhầm 0 tin thật, không crawl lại.
   * Optional để fake cũ không phải implement.
   */
  releaseClaim?(scopeKey: string, statDate: string): Promise<void>;
  upsert(row: PriceStatsRow): Promise<void>;
}

export interface CheckInput {
  id: string;
  originalText: string | null;
  province: string | null;
  regionName: string | null;
  wardName: string | null;
  priceVnd: number | null;
  areaM2: number | null;
  bedrooms: number | null;
}

export interface PipelineDeps {
  gateway: MarketGateway;
  listings: MarketListingRepo;
  stats: PriceStatsRepo;
  /**
   * V2: tra mã địa danh. Tách khỏi listings vì gazetteer KHÔNG phải bảng giá.
   * Không truyền vào -> pipeline chạy đúng như bản cũ (chỉ tra market_listings).
   */
  geo?: GeoResolver;
  now?: () => Date;
}

/**
 * Ghi rõ khi đã BIẾT phường nhưng không đủ mẫu nên phải mở rộng phạm vi.
 * Không dùng lại limitation của tầng tỉnh: "chưa xác định được khu vực chi tiết"
 * sẽ thành lời nói dối — ta ĐÃ xác định được phường, chỉ là thiếu dữ liệu.
 */
export const LIMITATION_WIDENED_FROM_WARD =
  "Không đủ dữ liệu tham chiếu ở phạm vi phường, đang mở rộng phạm vi so sánh.";

export type PipelineResult =
  | { ok: true; snapshot: PriceIntelligence; fromCache: boolean }
  | { ok: false; reason: string };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Chuẩn hoá 1 ad của gateway sang dạng lưu cache. price_per_m2 TÍNH LẠI. */
export function normalizeAd(ad: RawMarketAd, source: string): NormalizedListing | null {
  const externalId = String(ad.list_id ?? "").trim();
  if (!externalId) return null;
  const price = numOrNull(ad.price);
  const size = numOrNull(ad.size);
  const ppm2 = calcPpm2(price, size);
  if (ppm2 === null) return null; // không có giá/m² hợp lệ thì không lưu làm gì

  return {
    source,
    external_id: externalId,
    category_code: numOrNull(ad.category),
    category_name: str(ad.category_name) || null,
    region_name: str(ad.region_name) || null,
    region_v2: numOrNull(ad.region_v2),
    area_name: str(ad.area_name) || null,
    area_v2: numOrNull(ad.area_v2),
    title: str(ad.subject) || null,
    price_vnd: price,
    size_m2: size,
    living_size_m2: numOrNull(ad.living_size),
    land_front_m: numOrNull(ad.length),
    land_side_m: numOrNull(ad.width),
    rooms: numOrNull(ad.rooms),
    price_per_m2: ppm2,
    lat: numOrNull(ad.latitude),
    lng: numOrNull(ad.longitude),
    listed_at: ad.list_time ? new Date(ad.list_time).toISOString() : null,
    // list_id là number ở gateway -> dùng externalId đã chuẩn hoá thành string
    url: `https://www.nhatot.com/tin/${externalId}.htm`,
    is_price_valid: ad.is_price_not_valid !== true,
    is_promoted: ad.is_sticky === true || ad.company_ad === true || (ad.job_tier ?? 0) > 0,
    is_rent: str(ad.type) !== "" && str(ad.type) !== "s",
  };
}

/**
 * Xếp comparable. Thứ tự ưu tiên đã duyệt:
 *   1. cùng loại BĐS  (lọc cứng — không để khác loại đứng đầu)
 *   2. gần diện tích
 *   3. gần price/m²
 *   4. gần vị trí địa lý (nếu có tọa độ ở cả hai đầu)
 * Cùng scope level + cùng category là điều kiện đã bảo đảm khi lấy từ cache.
 */
export function rankComparables(args: {
  candidates: NormalizedListing[];
  scope: PriceScope;
  targetAreaM2: number | null;
  targetPpm2: number | null;
  targetLat: number | null;
  targetLng: number | null;
  limit: number;
}): PriceComparable[] {
  const { candidates, scope, targetAreaM2, targetPpm2, targetLat, targetLng, limit } = args;

  const sameCategory = candidates.filter((c) => c.category_code === scope.category_code);
  const pool = sameCategory.length > 0 ? sameCategory : candidates;

  const rel = (a: number, b: number) => (b > 0 ? Math.abs(a - b) / b : Math.abs(a - b));

  const scored = pool.map((c) => {
    const areaScore =
      targetAreaM2 != null && c.size_m2 != null
        ? 1 - Math.min(1, rel(c.size_m2, targetAreaM2))
        : 0.5; // không biết diện tích -> trung tính, không phạt
    const ppm2Score =
      targetPpm2 != null && Number.isFinite(targetPpm2) && targetPpm2 > 0
        ? 1 - Math.min(1, rel(c.price_per_m2, targetPpm2))
        : 0.5;
    const km = haversineKm(targetLat, targetLng, c.lat, c.lng);
    const distScore = km == null ? null : 1 / (1 + km);

    // Có tọa độ thì chia lại trọng số cho phần địa lý; không có thì bỏ hẳn.
    const base = distScore == null ? 0.45 * areaScore + 0.55 * ppm2Score : 0.4 * areaScore + 0.35 * ppm2Score + 0.25 * distScore;

    return { c, km, score: base };
  });

  scored.sort((a, b) => b.score - a.score || a.c.price_per_m2 - b.c.price_per_m2);

  return scored.slice(0, limit).map(({ c, km }) => ({
    external_id: c.external_id,
    title: c.title,
    size_m2: c.size_m2,
    price_vnd: c.price_vnd,
    price_per_m2: Math.round(c.price_per_m2),
    rooms: c.rooms,
    distance_km: km,
    listed_at: c.listed_at,
    url: c.url,
  }));
}

/** Sinh scope từ 1 lần check. Không có loại BĐS -> dừng, không crawl. */
export function scopeForCheck(check: CheckInput, wardIndex: WardIndex) {
  const categoryCode = detectCategoryCode(check.originalText);
  const regionName = check.regionName ?? check.province;
  return resolveScope(
    {
      categoryCode,
      regionName,
      wardName: check.wardName,
      // Mã tỉnh lấy từ cache trước; nếu miss thì pipeline thử gateway rồi thử lại.
      regionV2: wardIndex.findRegionV2(regionName),
      areaM2: check.areaM2,
      bedrooms: check.bedrooms,
    },
    wardIndex,
  );
}

function indexFrom(repo: MarketListingRepo): WardIndex {
  return {
    findAreaV2: (areaName, regionName) => repo.findAreaV2(areaName, regionName),
    findRegionV2: (regionName) => repo.findRegionV2(regionName),
  };
}

/**
 * Đảm bảo có hàng thống kê cho 1 scope: đường nhanh (đã có hôm nay) hoặc crawl.
 * Tách riêng để PHASE 5 gọi lại cho tầng tỉnh mà không nhân bản logic claim.
 */
async function ensureStatsRow(args: {
  deps: PipelineDeps;
  scope: PriceScope;
  regionV2: number | null;
  areaV2: number | null;
  /** Mã quận cho tham số area_v2 khi crawl. */
  crawlAreaV2: number | null;
  level: "ward" | "area";
  statDate: string;
  iso: string;
}): Promise<{ ok: true; row: PriceStatsRow } | { ok: false }> {
  const { deps, scope, regionV2, areaV2, crawlAreaV2, level, statDate, iso } = args;

  // Đường nhanh: scope này đã có thống kê hôm nay -> không crawl.
  const existing = await deps.stats.get(scope.scope_key, statDate);
  if (existing) return { ok: true, row: existing };

  const claimed = await deps.stats.claim({
    scopeKey: scope.scope_key,
    statDate,
    scope,
    source: MARKET_SOURCE,
  });
  if (!claimed) {
    // Người khác đang crawl cùng scope -> đọc lại, không tự crawl trùng
    const row = await deps.stats.get(scope.scope_key, statDate);
    return row ? { ok: true, row } : { ok: false };
  }

  const crawled = await crawlScope({
    gateway: deps.gateway,
    scope,
    regionV2,
    areaV2,
    crawlAreaV2,
    level,
  });

  // CRAWL HỎNG (gateway lỗi/timeout) khác HẾT TIN: ta không biết khu vực này có
  // bao nhiêu tin. Ghi `sample_size=0` lúc này là nói dối, và vì dòng đó tồn tại
  // cả ngày nên không lần nào crawl lại được. Bỏ claim rồi ném lỗi: route đã
  // catch, trả "tạm thời chưa khả dụng" và KHÔNG lưu snapshot.
  if (!crawled.ok) {
    try {
      await deps.stats.releaseClaim?.(scope.scope_key, statDate);
    } catch {
      /* Best effort: lỗi xoá claim không được che lỗi gốc. */
    }
    throw new PricePipelineError("crawl_gateway_unavailable");
  }

  await deps.listings.upsertMany(crawled.listings);
  const computed = computeStats({
    filtered: filterSample(crawled.listings, scope),
    scopeLevel: scope.scope_level,
  });
  const invalidCount =
    computed.excluded.rent +
    computed.excluded.invalid_price_flag +
    computed.excluded.invalid_size +
    computed.excluded.invalid_price +
    computed.excluded.category_mismatch +
    computed.excluded.ppm2_out_of_range +
    computed.excluded.size_out_of_band +
    computed.excluded.rooms_out_of_band +
    computed.excluded.duplicate_external_id;

  const row = statsRowFromArgs({
    scope,
    scopeKey: scope.scope_key,
    statDate,
    sampleSize: computed.sample_size,
    trimmedSize: computed.trimmed_size,
    excludedPromoted: computed.excluded.promoted,
    excludedInvalid: invalidCount,
    statistics: computed.statistics,
    qualityScore: computed.quality_score,
    source: MARKET_SOURCE,
    computedAt: iso,
  });
  await deps.stats.upsert(row);
  return { ok: true, row };
}

/**
 * PHASE 5 — tầng phường không đủ mẫu thì thử tầng tỉnh.
 * CHỈ trả về khi tầng tỉnh THẬT SỰ có số. Nếu tỉnh cũng thiếu thì trả null để
 * giữ kết quả phường (statistics = null) — thà không có số còn hơn nói sai.
 */
async function widenToProvince(args: {
  deps: PipelineDeps;
  check: CheckInput;
  index: WardIndex;
  statDate: string;
  iso: string;
  /** Mã tỉnh đã resolve ở tầng trước — index có thể rỗng ở cold-start. */
  regionV2Hint: number | null;
}): Promise<{ scope: PriceScope; regionV2: number | null; row: PriceStatsRow } | null> {
  const { deps, check, index, statDate, iso, regionV2Hint } = args;
  const idx: WardIndex = { ...index };
  if (regionV2Hint != null) idx.findRegionV2 = () => regionV2Hint;
  const res = scopeForCheck({ ...check, wardName: null }, idx);
  if (!res.ok || res.scope.scope_level !== "province") return null;

  const regionV2 = regionV2Hint ?? index.findRegionV2(res.scope.region_name);
  const got = await ensureStatsRow({
    deps,
    scope: res.scope,
    regionV2,
    areaV2: null,
    // Mở rộng sang tầng TỈNH: không lọc quận, không lọc phường.
    crawlAreaV2: null,
    level: "area",
    statDate,
    iso,
  });
  if (!got.ok || got.row.median_ppm2 == null) return null;

  return { scope: res.scope, regionV2, row: got.row };
}

/**
 * Điểm vào duy nhất của Phase 1: check -> snapshot price-v1.
 * Không tự quyết "đã có rồi" (việc đó thuộc route) và không tự ghi vào checks.
 */
export async function generatePriceIntelligence(
  check: CheckInput,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const now = deps.now ? deps.now() : new Date();
  const iso = now.toISOString();
  const statDate = iso.slice(0, 10);
  const index = indexFrom(deps.listings);
  // Mã phường đã tra V2. Giữ lại để scope_key dùng đúng, vì tra lại index sẽ trượt.
  let resolvedAreaV2: number | null = null;
  // Mã QUẬN để đưa vào tham số area_v2 khi crawl. Tách khỏi resolvedAreaV2 vì
  // gateway không hiểu mã phường ở tham số đó (trả 200 nhưng 0 tin).
  let resolvedCrawlAreaV2: number | null = null;
  // Cấp của tên đã khớp: quyết định post-filter so `ward` hay `area_v2`.
  let resolvedLevel: "ward" | "area" = "area";
  // Mã tỉnh đã resolve. PHẢI nhớ lại: index rỗng ở cold-start, nên tra lại
  // index sẽ ra null và crawl sẽ chạy KHÔNG có bộ lọc tỉnh — tức lấy dữ liệu
  // cả nước rồi dán nhãn tỉnh/phường. Đây là lý do regionV2 phải đi theo scope.
  let resolvedRegionV2: number | null = null;

  let resolution = scopeForCheck(check, index);

  // Tầng tỉnh: thiếu mã tỉnh thì hỏi gateway (giữ nguyên hành vi cũ).
  if (!resolution.ok && check.regionName) {
    // Chỉ tốn 1 lần gọi khi thật sự thiếu mã tỉnh
    const r = await deps.gateway.resolveRegionCode(check.regionName);
    if (r != null) {
      resolvedRegionV2 = r;
      resolution = scopeForCheck(check, { ...index, findRegionV2: () => r });
    }
  }
  if (!resolution.ok) return { ok: false, reason: resolution.reason };

  // V2 — có TÊN phường nhưng chưa lên được tầng phường (cold-start, index rỗng)
  // thì tra gazetteer, rồi mới hỏi gateway. Không có deps.geo -> bỏ qua, y hành vi cũ.
  const wardName = (check.wardName ?? "").trim();
  // Log trước khi quyết định có gọi resolver hay không. Đây là chỗ phân định
  // giữa "checks.ward_name rỗng" và "có tên phường nhưng tra không ra mã".
  // Chỉ log độ dài, không log tên/giá/url/SĐT.
  console.log(
    `[price-scope-geo] check_id=${check.id} has_geo=${deps.geo ? "yes" : "no"} ` +
      `ward_present=${wardName ? "yes" : "no"} ward_len=${wardName.length} ` +
      `region_present=${resolution.scope.region_name ? "yes" : "no"} ` +
      `scope_before=${resolution.scope.scope_level}`,
  );
  if (deps.geo && wardName && resolution.scope.scope_level !== "ward") {
    const regionNameForGeo = resolution.scope.region_name;
    const regionHint = resolvedRegionV2 ?? index.findRegionV2(regionNameForGeo);
    const geo = await deps.geo.resolveAreaCode(regionNameForGeo, wardName, {
      regionV2Hint: regionHint,
    });
    if (geo) {
      const idx: WardIndex = { ...index, findAreaV2: () => ({ areaV2: geo.areaCode, areaName: wardName }) };
      if (regionHint != null) idx.findRegionV2 = () => regionHint;
      const retry = scopeForCheck(check, idx);
      if (retry.ok && retry.scope.scope_level === "ward") {
        resolution = retry;
        // Nhớ cả hai mã: scope_key lấy mã phường, crawl lấy mã quận.
        resolvedAreaV2 = geo.areaCode;
        resolvedCrawlAreaV2 = geo.crawlAreaCode;
        resolvedLevel = geo.level;
        if (resolvedRegionV2 == null && geo.region_v2 != null) resolvedRegionV2 = geo.region_v2;
        console.log(
          `[price-scope-geo] check_id=${check.id} recover=ward area_v2=${geo.areaCode} ` +
            `crawl_area_v2=${geo.crawlAreaCode ?? "-"} level=${geo.level}`,
        );
      } else {
        // Có tên phường nhưng vẫn không lên được tầng phường -> biết đúng là do
        // tra mã, không phải do mất tên ở checks.
        console.warn(
          `[price-scope-geo] check_id=${check.id} recover=failed reason=retry_not_ward ` +
            `scope_after=${retry.ok ? retry.scope.scope_level : "resolve_error"}`,
        );
      }
    }
  }

  let scope = resolution.scope;
  // Ưu tiên mã đã tra, sau đó mới tra index. KHÔNG để null: crawl thiếu
  // area_v2 sẽ lấy dữ liệu cả nước rồi gắn nhãn phường.
  let regionV2 = resolvedRegionV2 ?? index.findRegionV2(scope.region_name);
  let areaV2 =
    scope.scope_level === "ward"
      ? (resolvedAreaV2 ?? index.findAreaV2(scope.area_name ?? "", scope.region_name)?.areaV2 ?? null)
      : null;
  // Tham số area_v2 của crawl LUÔN là mã quận. Ở tầng tỉnh không lọc quận.
  let crawlAreaV2 = scope.scope_level === "ward" ? resolvedCrawlAreaV2 : null;

  let row: PriceStatsRow | null = null;
  let widenedFromWard = false;

  if (scope.scope_level === "ward") {
    const got = await ensureStatsRow({
      deps,
      scope,
      regionV2,
      areaV2,
      crawlAreaV2,
      level: resolvedLevel,
      statDate,
      iso,
    });
    if (!got.ok) return { ok: false, reason: REASON_NO_SAMPLE };
    row = got.row;

    // PHẢI đủ mẫu mới được dựng số. Thiếu thì mở rộng sang tầng tỉnh —
    // nhưng chỉ khi tầng tỉnh THẬT SỰ có số, nếu không thì giữ kết quả phường
    // (statistics = null) để không nói dối rằng đã mở rộng.
    if (row.median_ppm2 == null) {
      const wider = await widenToProvince({ deps, check, index, statDate, iso, regionV2Hint: regionV2 });
      if (wider) {
        scope = wider.scope;
        regionV2 = wider.regionV2;
        areaV2 = null;
        crawlAreaV2 = null;
        row = wider.row;
        widenedFromWard = true;
      }
    }
  } else {
    const got = await ensureStatsRow({
      deps,
      scope,
      regionV2,
      areaV2,
      crawlAreaV2,
      level: "area",
      statDate,
      iso,
    });
    if (!got.ok) return { ok: false, reason: REASON_NO_SAMPLE };
    row = got.row;
  }

  return buildSnapshot({
    check,
    scope,
    statsRow: row,
    iso,
    deps,
    regionV2,
    areaV2,
    crawlAreaV2,
    extraLimitations: widenedFromWard ? [LIMITATION_WIDENED_FROM_WARD] : [],
  });
}

// Nhãn hiển thị khi KHÔNG có tọa độ.
// "Cùng nhóm tham chiệu" chỉ nói về bộ lọc, KHÔNG nói vị trí địa lý -> không dùng.
export const DISTANCE_FALLBACK_LABEL = "Không có dữ liệu khoảng cách";

/** Được phép hiển thị median/band không? Không thì UI chỉ hiện lời giải thích. */
export function canShowStatistics(snapshot: PriceIntelligence): boolean {
  return snapshot.statistics !== null && snapshot.sample_size >= MIN_SAMPLE_SIZE;
}

/**
 * Dựng snapshot từ hàng thống kê đã lưu — HÀM THUẦN.
 * statistics = null khi median_ppm2 null (tức lúc crawl chưa đủ mẫu).
 */
export function buildSnapshotFromRow(args: {
  row: PriceStatsRow;
  scope: PriceScope;
  check: CheckInput;
  iso: string;
  comparables: PriceComparable[];
  /** Limitation bổ sung, ví dụ khi đã mở rộng từ phường sang tỉnh. */
  extraLimitations?: string[];
}): PriceIntelligence {
  const { row, scope, check, iso, comparables } = args;
  const targetPpm2 = calcPpm2(check.priceVnd, check.areaM2);

  const limitations = [
    "Giá chào bán lấy từ tin đăng, không phải giá giao dịch thực tế.",
    scope.scope_level === "ward"
      ? "Nhóm tham chiếu gồm tin cùng phường, cùng loại và diện tích tương đương."
      : "Nhóm tham chiếu đang ở phạm vi rộng hơn do chưa xác định được khu vực chi tiết.",
    ...(args.extraLimitations ?? []),
  ];

  return {
    version: PRICE_INTELLIGENCE_VERSION,
    generated_at: iso,
    source: MARKET_SOURCE,
    scope_level: scope.scope_level,
    scope,
    sample_size: row.sample_size,
    trimmed_size: row.trimmed_size,
    confidence: confidenceFrom({ scopeLevel: row.scope_level, trimmed: row.trimmed_size }),
    quality_score: row.quality_score,
    excluded_promoted: row.excluded_promoted,
    excluded_invalid: row.excluded_invalid,
    statistics:
      row.median_ppm2 != null && row.p25_ppm2 != null && row.p75_ppm2 != null
        ? {
            p25_ppm2: row.p25_ppm2,
            median_ppm2: row.median_ppm2,
            p75_ppm2: row.p75_ppm2,
            min_ppm2: row.min_ppm2 ?? row.p25_ppm2,
            max_ppm2: row.max_ppm2 ?? row.p75_ppm2,
          }
        : null,
    comparables,
    target: {
      // Làm tròn như comparable để UI hiển thị nhất quán
      price_per_m2: targetPpm2 === null ? null : Math.round(targetPpm2),
      difference_percent: differencePercent(targetPpm2, row.median_ppm2),
    },
    limitations,
  };
}

async function buildSnapshot(args: {
  check: CheckInput;
  scope: PriceScope;
  statsRow: PriceStatsRow;
  iso: string;
  deps: PipelineDeps;
  regionV2: number | null;
  areaV2: number | null;
  /**
   * Mã QUẬN để tra `market_listings.area_v2`. Bắt buộc mã quận, KHÔNG phải mã
   * phường: cột `area_v2` lưu `ad.area_v2` của tin đã crawl (gateway trả mã
   * quận), còn `areaV2` ở trên là mã phường dùng cho scope_key. Tra bằng mã
   * phường -> khớp 0 dòng -> `comparables` luôn rỗng ở tầng phường.
   */
  crawlAreaV2: number | null;
  extraLimitations?: string[];
}): Promise<PipelineResult> {
  const { check, scope, statsRow, iso, deps, regionV2, crawlAreaV2, extraLimitations } = args;
  const candidates = await deps.listings.listByGeo({
    regionV2,
    areaV2: crawlAreaV2,
    categoryCode: scope.category_code,
  });

  const comparables = rankComparables({
    candidates,
    scope,
    targetAreaM2: check.areaM2,
    targetPpm2: calcPpm2(check.priceVnd, check.areaM2),
    // Tin đang check chưa có tọa độ ở price-v1 -> distance luôn null,
    // UI hiện "Cùng phường"/"Cùng khu vực". Không đoán.
    targetLat: null,
    targetLng: null,
    limit: 6,
  });

  return {
    ok: true,
    fromCache: true,
    snapshot: buildSnapshotFromRow({
      row: statsRow,
      scope,
      check,
      iso,
      comparables,
      extraLimitations,
    }),
  };
}

export interface CrawlOutcome {
  /**
   * false = CRAWL HỎNG (gateway lỗi/timeout), KHÔNG phải khu vực hết tin.
   * Tầng trên phải bỏ dòng claim và KHÔNG ghi stats, thay vì lưu sample_size=0.
   */
  ok: boolean;
  listings: NormalizedListing[];
  calls: number;
  /** Số tin bị loại vì không gắn mã phường, ở tầng phường. */
  droppedNoCode: number;
}

/**
 * Crawl theo PARTITION vì gateway không phân trang (page bị bỏ qua — đã đo).
 * Mỗi lần gọi = 1 tổ hợp cg × rooms. Có band diện tích đẩy xuống server.
 */
export async function crawlScope(args: {
  gateway: MarketGateway;
  scope: PriceScope;
  regionV2: number | null;
  areaV2: number | null;
  /** Mã quận đưa vào tham số area_v2 khi crawl. Khác `areaV2` ở tầng phường. */
  crawlAreaV2: number | null;
  /** Cấp của tên đã khớp — quyết định post-filter so `ward` hay `area_v2`. */
  level: "ward" | "area";
  maxCalls?: number;
}): Promise<CrawlOutcome> {
  const { gateway, scope, regionV2, areaV2, crawlAreaV2, level } = args;
  const maxCalls = args.maxCalls ?? MAX_GATEWAY_CALLS;
  const collected: NormalizedListing[] = [];
  let calls = 0;
  // Mã dùng để SO SÁNH từng tin. Ở tầng phường đó là mã phường (`ward`),
  // không phải mã quận — so sánh nhầm hai cấp sẽ loạt bỏ hết tin.
  const matchCode = areaV2;
  let droppedNoCode = 0;

  for (const categoryCode of [scope.category_code]) {
    for (const rooms of roomsPartitions(scope)) {
      if (calls >= maxCalls || collected.length >= MAX_LISTINGS) break;
      const fetchScope = {
        categoryCode,
        regionV2,
        // Gateway CHỈ hiểu mã quận ở tham số này. Truyền mã phường trả
        // HTTP 200 nhưng 0 tin.
        areaV2: crawlAreaV2,
        sizeMinM2: scope.size_min_m2,
        sizeMaxM2: scope.size_max_m2,
        rooms,
        limit: gateway.maxItemsPerRequest,
      };
      // CÓ fetchListingsResult -> biết lỗi gateway với "0 tin thật".
      // KHÔNG có -> coi như thành công (đúng hành vi cũ, fake cũ không đổi).
      const fetched = gateway.fetchListingsResult
        ? await gateway.fetchListingsResult(fetchScope)
        : { ok: true, ads: await gateway.fetchListings(fetchScope) };
      calls += 1;
      if (!fetched.ok) {
        // Dừng ngay: trả về 0 tin kèm ok=false. Tầng trên KHÔNG được ghi stats,
        // vì ta không biết khu vực này thật sự có bao nhiêu tin.
        return { ok: false, listings: [], calls, droppedNoCode };
      }
      const ads = fetched.ads;

      for (const ad of ads) {
        // KHÔNG tin tuyệt đối việc gateway lọc đúng. Tin sai địa lý = sai giá
        // tham chiếu, và đây là nơi duy nhất chặn được điều đó.
        // Lọc trên ad THÔ trước khi chuẩn hoá: ward chỉ tồn tại ở gateway, không
        // phải cột trong market_listings, nên không thể đưa vào NormalizedListing.
        if (regionV2 != null) {
          const adRegion = numOrNull(ad.region_v2);
          if (adRegion != null && adRegion !== regionV2) continue;
        }
        if (matchCode != null) {
          if (level === "ward") {
            // Ở tầng phường, so mã PHƯỜNG. Tin không gắn mã phường thì KHÔNG
            // giữ: không chứng minh được nó thuộc phường này, giữ là đoán.
            const adWard = numOrNull(ad.ward);
            if (adWard == null) {
              droppedNoCode += 1;
              continue;
            }
            if (adWard !== matchCode) continue;
          } else {
            const adArea = numOrNull(ad.area_v2);
            if (adArea != null && adArea !== matchCode) continue;
          }
        }
        const n = normalizeAd(ad, gateway.source);
        if (!n) continue;
        collected.push(n);
      }
    }
  }

  return { ok: true, listings: collected, calls, droppedNoCode };
}

/** Các giá trị rooms cần gọi. Gateway lọc rooms TỐI THIỂU nên ta gọi theo ngưỡng. */
function roomsPartitions(scope: PriceScope): (number | null)[] {
  if (scope.rooms_min == null) return [null];
  const out: number[] = [];
  const max = scope.rooms_max ?? scope.rooms_min;
  for (let r = scope.rooms_min; r <= Math.max(scope.rooms_min, max); r += 1) out.push(r);
  return out.length > 0 ? out : [scope.rooms_min];
}

export function statsRowFromArgs(args: {
  scope: PriceScope;
  scopeKey: string;
  statDate: string;
  sampleSize: number;
  trimmedSize: number;
  excludedPromoted: number;
  excludedInvalid: number;
  statistics: ReturnType<typeof computeStats>["statistics"];
  qualityScore: number | null;
  source: string;
  computedAt: string;
}): PriceStatsRow {
  return {
    scope_key: args.scopeKey,
    stat_date: args.statDate,
    scope_level: args.scope.scope_level,
    scope_description: args.scope.scope_description,
    region_name: args.scope.region_name,
    area_name: args.scope.area_name,
    category_code: args.scope.category_code,
    size_min_m2: args.scope.size_min_m2,
    size_max_m2: args.scope.size_max_m2,
    rooms: args.scope.rooms_min,
    sample_size: args.sampleSize,
    trimmed_size: args.trimmedSize,
    excluded_promoted: args.excludedPromoted,
    excluded_invalid: args.excludedInvalid,
    p25_ppm2: args.statistics?.p25_ppm2 ?? null,
    median_ppm2: args.statistics?.median_ppm2 ?? null,
    p75_ppm2: args.statistics?.p75_ppm2 ?? null,
    min_ppm2: args.statistics?.min_ppm2 ?? null,
    max_ppm2: args.statistics?.max_ppm2 ?? null,
    quality_score: args.qualityScore,
    source: args.source,
    computed_at: args.computedAt,
  };
}

export { filterSample, computeStats, differencePercent, calcPpm2 };
