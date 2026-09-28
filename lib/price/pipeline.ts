// Pipeline Price Intelligence — orchestrate: scope -> crawl -> lọc -> thống kê ->
// chọn comparable -> snapshot. MọI I/O đi qua interface để test không cần DB/mạng.

import { haversineKm } from "@/lib/geo/distance";
import { calcPpm2, computeStats, confidenceFrom, differencePercent, filterSample } from "./stats";
import { detectCategoryCode, resolveScope, type WardIndex } from "./scope";
import type { GeoResolver } from "./geo-resolver";
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
  statDate: string;
  iso: string;
}): Promise<{ ok: true; row: PriceStatsRow } | { ok: false }> {
  const { deps, scope, regionV2, areaV2, statDate, iso } = args;

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

  const crawled = await crawlScope({ gateway: deps.gateway, scope, regionV2, areaV2 });
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
  // Mã phường đã tra V2. Giữ lại để crawl dùng đúng, vì tra lại index sẽ trượt.
  let resolvedAreaV2: number | null = null;
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
  if (deps.geo && wardName && resolution.scope.scope_level !== "ward") {
    const regionNameForGeo = resolution.scope.region_name;
    const regionHint = resolvedRegionV2 ?? index.findRegionV2(regionNameForGeo);
    const geo = await deps.geo.resolveAreaCode(regionNameForGeo, wardName, {
      regionV2Hint: regionHint,
    });
    if (geo) {
      const idx: WardIndex = { ...index, findAreaV2: () => ({ areaV2: geo.area_v2, areaName: wardName }) };
      if (regionHint != null) idx.findRegionV2 = () => regionHint;
      const retry = scopeForCheck(check, idx);
      if (retry.ok && retry.scope.scope_level === "ward") {
        resolution = retry;
        // Nhớ mã để crawl dùng đúng — nếu crawl lại tra index sẽ ra null.
        resolvedAreaV2 = geo.area_v2;
        if (resolvedRegionV2 == null && geo.region_v2 != null) resolvedRegionV2 = geo.region_v2;
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

  let row: PriceStatsRow | null = null;
  let widenedFromWard = false;

  if (scope.scope_level === "ward") {
    const got = await ensureStatsRow({ deps, scope, regionV2, areaV2, statDate, iso });
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
        row = wider.row;
        widenedFromWard = true;
      }
    }
  } else {
    const got = await ensureStatsRow({ deps, scope, regionV2, areaV2, statDate, iso });
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
  extraLimitations?: string[];
}): Promise<PipelineResult> {
  const { check, scope, statsRow, iso, deps, regionV2, areaV2, extraLimitations } = args;
  const candidates = await deps.listings.listByGeo({
    regionV2,
    areaV2,
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
  listings: NormalizedListing[];
  calls: number;
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
  maxCalls?: number;
}): Promise<CrawlOutcome> {
  const { gateway, scope, regionV2, areaV2 } = args;
  const maxCalls = args.maxCalls ?? MAX_GATEWAY_CALLS;
  const collected: NormalizedListing[] = [];
  let calls = 0;

  for (const categoryCode of [scope.category_code]) {
    for (const rooms of roomsPartitions(scope)) {
      if (calls >= maxCalls || collected.length >= MAX_LISTINGS) break;
      const ads = await gateway.fetchListings({
        categoryCode,
        regionV2,
        areaV2,
        sizeMinM2: scope.size_min_m2,
        sizeMaxM2: scope.size_max_m2,
        rooms,
        limit: gateway.maxItemsPerRequest,
      });
      calls += 1;
      for (const ad of ads) {
        const n = normalizeAd(ad, gateway.source);
        if (!n) continue;
        // KHÔNG tin tuyệt đối việc gateway lọc đúng. Tin sai địa lý = sai giá
        // tham chiếu, và đây là nơi duy nhất chặn được điều đó.
        // Chỉ loại khi mã CÓ và MÂU THUẪN yêu cầu; tin không có mã thì không
        // chứng minh được là sai nên vẫn giữ (nếu siết thành loại hết thì
        // gateway không trả area_v2 sẽ khiến tầng phường luôn rỗng -> luôn rơi
        // về tỉnh, tức V2 không bao giờ dùng được).
        if (regionV2 != null && n.region_v2 != null && n.region_v2 !== regionV2) continue;
        if (areaV2 != null && n.area_v2 != null && n.area_v2 !== areaV2) continue;
        collected.push(n);
      }
    }
  }

  return { listings: collected, calls };
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
