// Self-check: price-v1 pipeline — snapshot, cache, ranking, budget. Chạy: npm test
// Fake gateway + fake repo trong bộ nhớ: không mạng, không DB.
import { strict as assert } from "node:assert";
import {
  buildSnapshotFromRow,
  canShowStatistics,
  crawlScope,
  DISTANCE_FALLBACK_LABEL,
  generatePriceIntelligence,
  normalizeAd,
  rankComparables,
  REASON_NO_CATEGORY,
  type CheckInput,
  type MarketListingRepo,
  type PriceStatsRepo,
} from "../lib/price/pipeline.ts";
import { buildGatewayParams, type FetchScope, type MarketGateway, type RawMarketAd } from "../lib/price/gateway.ts";
import type { NormalizedListing, PriceScope, PriceStatsRow } from "../lib/price/types.ts";
import { PricePipelineError, safeErrorCode } from "../lib/price/errors.ts";

/** Mô phỏng đúng cách route gọi: bắt lỗi, trả null => soft failure. */
const generatePriceSafe = async (
  check: CheckInput,
  deps: { gateway: MarketGateway; listings: MarketListingRepo; stats: PriceStatsRepo },
): Promise<{ ok: boolean } | null> => {
  try {
    return (await generatePriceIntelligence(check, deps)) as { ok: boolean };
  } catch {
    return null;
  }
};

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass += 1;
      console.log(`  ok  ${name}`);
    })
    .catch((e: Error) => {
      fail += 1;
      console.log(`FAIL  ${name}\n      ${e.message}`);
    });
}

// ---------------------------------------------------------------- fake gateway
let adSeq = 0;
function makeAd(over: Partial<RawMarketAd> = {}): RawMarketAd {
  adSeq += 1;
  // size 50 nằm trong band 27-72 của tin check (45m2) để không bị loại oops
  const size = over.size ?? 50;
  const price = over.price ?? 5_000_000_000;
  return {
    list_id: over.list_id ?? 900_000 + adSeq,
    type: "s",
    category: 1010,
    category_name: "Căn hộ",
    region_v2: 13000,
    region_name: "Tp Hồ Chí Minh",
    area_v2: 13101,
    area_name: "Quận 6",
    subject: `Tin test ${adSeq}`,
    price,
    size,
    size_unit_string: "m²",
    rooms: 3,
    latitude: 10.75598,
    longitude: 106.62464,
    list_time: 1790499660369,
    ...over,
  } as RawMarketAd;
}

function fakeGateway(adsPerCall: number, calls: { n: number }): MarketGateway {
  return {
    source: "chotot_gateway",
    supportsPagination: false,
    maxItemsPerRequest: 50,
    async fetchListings() {
      calls.n += 1;
      return Array.from({ length: adsPerCall }, () => makeAd());
    },
    async fetchTotal() {
      return null;
    },
    async resolveRegionCode() {
      return 13000;
    },
    async resolveAreaCode() {
      return 13101;
    },
  };
}

// ------------------------------------------------------------------ fake repos
class MemListings implements MarketListingRepo {
  rows: NormalizedListing[] = [];
  areaIndex = new Map<string, { areaV2: number; areaName: string }>();
  upserted = 0;

  async upsertMany(listings: NormalizedListing[]) {
    this.upserted += listings.length;
    for (const l of listings) {
      if (!this.rows.some((r) => r.external_id === l.external_id)) this.rows.push(l);
      if (l.area_name && l.area_v2 != null) {
        this.areaIndex.set(`${l.area_name}|${l.region_name ?? ""}`, {
          areaV2: l.area_v2,
          areaName: l.area_name,
        });
      }
    }
  }
  findAreaV2(areaName: string, regionName: string | null) {
    return this.areaIndex.get(`${areaName}|${regionName ?? ""}`) ?? null;
  }
  findRegionV2(regionName: string | null) {
    if (!regionName) return null;
    for (const r of this.rows) {
      if (r.region_name === regionName && r.region_v2 != null) return r.region_v2;
    }
    return null;
  }
  async listByGeo(args: { regionV2: number | null; areaV2: number | null; categoryCode: number }) {
    return this.rows.filter(
      (r) =>
        r.category_code === args.categoryCode &&
        (args.areaV2 == null || r.area_v2 === args.areaV2) &&
        (args.regionV2 == null || r.region_v2 === args.regionV2),
    );
  }
}

class MemStats implements PriceStatsRepo {
  rows = new Map<string, PriceStatsRow>();
  claims = new Set<string>();
  async get(scopeKey: string, statDate: string) {
    return this.rows.get(`${scopeKey}|${statDate}`) ?? null;
  }
  async claim(args: { scopeKey: string; statDate: string; scope: PriceScope; source: string }) {
    const k = `${args.scopeKey}|${args.statDate}`;
    if (this.rows.has(k) || this.claims.has(k)) return false;
    this.claims.add(k);
    return true;
  }
  async upsert(row: PriceStatsRow) {
    this.rows.set(`${row.scope_key}|${row.stat_date}`, row);
  }
}

const CHECK: CheckInput = {
  id: "chk1",
  originalText: "Bán căn hộ 2 phòng ngủ\nQuận 6, giá 3.3 tỷ, diện tích 45m2",
  province: "Tp Hồ Chí Minh",
  regionName: "Tp Hồ Chí Minh",
  wardName: "Quận 6",
  priceVnd: 3_300_000_000,
  areaM2: 45,
  bedrooms: 2,
};

async function main() {
  console.log("\n== normalizeAd: tự tính ppm2, giữ cờ chất lượng ==");

  await check("ppm2 tính từ price/size, bỏ qua giá trị gateway", () => {
    const n = normalizeAd(makeAd({ price: 5_000_000_000, size: 100, price_million_per_m2: 999 } as never), "x")!;
    assert.equal(n.price_per_m2, 50_000_000, "không dùng 999 của gateway");
  });

  await check("thiếu list_id hoặc ppm2 không hợp lệ -> null", () => {
    assert.equal(normalizeAd(makeAd({ list_id: "" } as never), "x"), null);
    assert.equal(normalizeAd(makeAd({ price: 0, size: 100 }), "x"), null);
    assert.equal(normalizeAd(makeAd({ size: 0 }), "x"), null);
  });

  await check("cờ: is_price_valid, is_promoted, is_rent", () => {
    assert.equal(normalizeAd(makeAd({ is_price_not_valid: true }), "x")!.is_price_valid, false);
    assert.equal(normalizeAd(makeAd({ is_sticky: true }), "x")!.is_promoted, true);
    assert.equal(normalizeAd(makeAd({ company_ad: true }), "x")!.is_promoted, true);
    assert.equal(normalizeAd(makeAd({ job_tier: 2 }), "x")!.is_promoted, true);
    assert.equal(normalizeAd(makeAd({ type: "u" }), "x")!.is_rent, true);
  });

  console.log("\n== buildGatewayParams: band dùng dấu gạch nối ==");

  await check("size/price dùng '-', không dùng ','", () => {
    const p = buildGatewayParams({ categoryCode: 1020, sizeMinM2: 27, sizeMaxM2: 72, priceMinVnd: 1e9, priceMaxVnd: 3e9 });
    assert.ok(p.includes("size=27-72"), p);
    assert.ok(p.includes("price=1000000000-3000000000"), p);
    assert.ok(!p.includes(","), "dấu phẩy làm gateway trả lỗi");
  });

  await check("limit clamp về <= 50, rooms là sàn tối thiểu", () => {
    assert.ok(buildGatewayParams({ categoryCode: 1020, limit: 999 }).includes("limit=50"));
    assert.ok(buildGatewayParams({ categoryCode: 1020, rooms: 2 }).includes("rooms=2"));
  });

  console.log("\n== rankComparables: ưu tiên đúng thứ tự đã duyệt ==");

  const SCOPE: PriceScope = {
    scope_level: "ward",
    scope_key: "ward:13101|cat:1020|size:27-72|rooms:1-3",
    scope_description: "Quận 6 · Nhà ở",
    region_name: "Tp Hồ Chí Minh",
    area_name: "Quận 6",
    category_code: 1020,
    category_name: "Nhà ở",
    size_min_m2: 27,
    size_max_m2: 72,
    rooms_min: 1,
    rooms_max: 3,
  };

  await check("tin KHÁC loại BĐS không được đứng đầu dù ppm2 rất gần", () => {
    const near: NormalizedListing = mkL("near", 1020, 45, 73_333_333);
    const samePpm2WrongType: NormalizedListing = mkL("wrong", 1000, 45, 73_333_334);
    const list = rankComparables({
      candidates: [samePpm2WrongType, near],
      scope: SCOPE,
      targetAreaM2: 45,
      targetPpm2: 73_333_333,
      targetLat: null,
      targetLng: null,
      limit: 5,
    });
    assert.equal(list[0].external_id, "near", "phải ưu tiên cùng loại trước");
  });

  await check("cùng loại thì ưu tiên gần diện tích trước gần ppm2", () => {
    const closeArea: NormalizedListing = mkL("closeArea", 1020, 46, 90_000_000);
    const closePpm2: NormalizedListing = mkL("closePpm2", 1020, 120, 73_000_000);
    const list = rankComparables({
      candidates: [closePpm2, closeArea],
      scope: SCOPE,
      targetAreaM2: 45,
      targetPpm2: 73_333_333,
      targetLat: null,
      targetLng: null,
      limit: 5,
    });
    assert.equal(list[0].external_id, "closeArea");
  });

  await check("có tọa độ thì khoảng cách được dùng, thiếu thì bỏ (không gán 0)", () => {
    const far: NormalizedListing = mkL("far", 1020, 46, 90_000_000, { lat: 21.0285, lng: 105.8542 });
    const near2: NormalizedListing = mkL("near2", 1020, 46, 90_000_000, { lat: 10.756, lng: 106.625 });
    const list = rankComparables({
      candidates: [far, near2],
      scope: SCOPE,
      targetAreaM2: 45,
      targetPpm2: 73_333_333,
      targetLat: 10.75598,
      targetLng: 106.62464,
      limit: 5,
    });
    assert.equal(list[0].external_id, "near2");
    assert.ok(list[0].distance_km !== null && list[0].distance_km < 1);
  });

  await check("giới hạn số comparable trả về", () => {
    const many = Array.from({ length: 30 }, (_, i) => mkL(`m${i}`, 1020, 40 + i, 70_000_000 + i));
    const list = rankComparables({
      candidates: many,
      scope: SCOPE,
      targetAreaM2: 45,
      targetPpm2: 73_333_333,
      targetLat: null,
      targetLng: null,
      limit: 6,
    });
    assert.equal(list.length, 6);
  });

  console.log("\n== generatePriceIntelligence ==");

  await check("không xác định loại BĐS -> not_enough_data, ZERO lần gọi gateway", async () => {
    const calls = { n: 0 };
    const deps = { gateway: fakeGateway(10, calls), listings: new MemListings(), stats: new MemStats() };
    const r = await generatePriceIntelligence({ ...CHECK, originalText: "Bán nghi đẹp 5 tỷ" }, deps);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, REASON_NO_CATEGORY);
    assert.equal(calls.n, 0, "không được crawl khi không đủ điều kiện");
  });

  await check("chưa có ward trong cache -> phải tra gateway rồi mới lên Tier 1", async () => {
    const calls = { n: 0 };
    const listings = new MemListings();
    const stats = new MemStats();
    const r = await generatePriceIntelligence(CHECK, { gateway: fakeGateway(20, calls), listings, stats });
    assert.ok(r.ok, "phải tạo được snapshot");
    assert.ok(calls.n > 0);
    assert.equal(listings.upserted > 0, true, "phải upsert listings");
  });

  await check("snapshot đủ trường bắt buộc", async () => {
    const calls = { n: 0 };
    const r = await generatePriceIntelligence(CHECK, {
      gateway: fakeGateway(20, calls),
      listings: new MemListings(),
      stats: new MemStats(),
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    const s = r.snapshot;
    assert.equal(s.version, "price-v1");
    assert.equal(s.source, "chotot_gateway");
    assert.ok(s.generated_at.length > 10);
    assert.ok(["ward", "province"].includes(s.scope_level));
    assert.equal(typeof s.sample_size, "number");
    assert.ok(["low", "medium", "high"].includes(s.confidence));
    assert.ok(Array.isArray(s.comparables));
    assert.ok(Array.isArray(s.limitations));
    assert.ok(s.limitations.some((l) => l.includes("không phải giá giao dịch thực tế")));
    assert.ok(s.target.price_per_m2 !== null);
  });

  await check("mẫu đủ -> có statistics; thiếu -> null", async () => {
    const big = { n: 0 };
    const r1 = await generatePriceIntelligence(CHECK, {
      gateway: fakeGateway(50, big),
      listings: new MemListings(),
      stats: new MemStats(),
    });
    assert.ok(r1.ok);
    if (r1.ok) assert.ok(r1.snapshot.statistics, "50 tin -> có statistics");

    const small = { n: 0 };
    // 1 tin / lần gọi, 3 partition rooms => 3 tin, dưới ngưỡng 15
    const r2 = await generatePriceIntelligence(CHECK, {
      gateway: fakeGateway(1, small),
      listings: new MemListings(),
      stats: new MemStats(),
    });
    assert.ok(r2.ok);
    if (r2.ok) {
      assert.ok(r2.snapshot.sample_size < 15, `sample=${r2.snapshot.sample_size}`);
      assert.equal(r2.snapshot.statistics, null, "dưới 15 -> không tạo số");
      assert.equal(canShowStatistics(r2.snapshot), false);
    }
  });

  await check("cache lạnh: chưa biết mã phường -> phải lên tỉnh, KHÔNG đoán", async () => {
    const calls = { n: 0 };
    const r = await generatePriceIntelligence(CHECK, {
      gateway: fakeGateway(20, calls),
      listings: new MemListings(), // chưa có dữ liệu -> không tra được area_v2
      stats: new MemStats(),
    });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.snapshot.scope_level, "province", "lần đầu của khu vực mới chỉ lên được tỉnh");
      assert.ok(
        r.snapshot.limitations.includes(
          "Nhóm tham chiếu đang ở phạm vi rộng hơn do chưa xác định được khu vực chi tiết.",
        ),
      );
    }
  });

  await check("cache ấm: đã biết mã phường -> lên Tier 1 'ward'", async () => {
    const listings = new MemListings();
    await listings.upsertMany([seedListing()]);
    const r = await generatePriceIntelligence(CHECK, {
      gateway: fakeGateway(20, { n: 0 }),
      listings,
      stats: new MemStats(),
    });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.snapshot.scope_level, "ward");
      assert.ok(r.snapshot.scope.scope_key.startsWith("ward:"));
    }
  });

  await check("lần 2 cùng scope -> đọc cache, KHÔNG crawl lại", async () => {
    const stats = new MemStats();
    const listings = new MemListings();
    await listings.upsertMany([seedListing()]); // ấm index từ đầu
    const c1 = { n: 0 };
    await generatePriceIntelligence(CHECK, { gateway: fakeGateway(50, c1), listings, stats });
    const c2 = { n: 0 };
    const r2 = await generatePriceIntelligence(CHECK, { gateway: fakeGateway(50, c2), listings, stats });
    assert.ok(r2.ok);
    assert.equal(c1.n > 0, true, "lần đầu phải crawl");
    assert.equal(c2.n, 0, "lần sau không được crawl lại cùng scope");
  });

  await check("crawl giữ trần ngân sách gọi gateway", async () => {
    const calls = { n: 0 };
    const r = await crawlScope({
      gateway: fakeGateway(50, calls),
      scope: { ...SCOPE, rooms_min: 1, rooms_max: 3 },
      regionV2: 13000,
      areaV2: 13101,
    });
    assert.ok(calls.n <= 18, `calls=${calls.n}`);
    assert.ok(r.calls <= 18);
  });

  await check("comparables không chứa chính tin đang check", async () => {
    const listings = new MemListings();
    const r = await generatePriceIntelligence(CHECK, {
      gateway: fakeGateway(50, { n: 0 }),
      listings,
      stats: new MemStats(),
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    // id của tin check không nằm trong market_listings nên không thể trùng,
    // nhưng phải bảo đảm không trả về bản ghi trùng nhau
    const ids = r.snapshot.comparables.map((c) => c.external_id);
    assert.equal(new Set(ids).size, ids.length, "không lặp comparable");
  });

  await check("buildSnapshotFromRow: statistics null khi median null", () => {
    const row: PriceStatsRow = {
      scope_key: "ward:1|cat:1020|size:na|rooms:na",
      stat_date: "2026-09-27",
      scope_level: "ward",
      scope_description: "Quận 6 · Nhà ở",
      region_name: "Tp Hồ Chí Minh",
      area_name: "Quận 6",
      category_code: 1020,
      size_min_m2: 27,
      size_max_m2: 72,
      rooms: 1,
      sample_size: 8,
      trimmed_size: 8,
      excluded_promoted: 0,
      excluded_invalid: 0,
      p25_ppm2: null,
      median_ppm2: null,
      p75_ppm2: null,
      min_ppm2: null,
      max_ppm2: null,
      quality_score: null,
      source: "chotot_gateway",
      computed_at: "2026-09-27T00:00:00.000Z",
    };
    const s = buildSnapshotFromRow({ row, scope: SCOPE, check: CHECK, iso: "2026-09-27T00:00:00.000Z", comparables: [] });
    assert.equal(s.statistics, null);
    assert.equal(s.target.difference_percent, null, "không median -> không chênh lệch");
    assert.equal(s.confidence, "low");
  });

  await check("scope province -> limitation đúng câu chuẩn bắt buộc", async () => {
    const r = await generatePriceIntelligence(CHECK, {
      gateway: fakeGateway(20, { n: 0 }),
      listings: new MemListings(),
      stats: new MemStats(),
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.snapshot.scope_level, "province");
    assert.ok(
      r.snapshot.limitations.includes(
        "Nhóm tham chiếu đang ở phạm vi rộng hơn do chưa xác định được khu vực chi tiết.",
      ),
      `limitations=${JSON.stringify(r.snapshot.limitations)}`,
    );
    // Không được dùng "Giá thị trường" — nguồn là giá chào bán từ tin đăng
    const all = JSON.stringify(r.snapshot).toLowerCase();
    assert.ok(!all.includes("giá thị trường"), "không được gọi là giá thị trường");
    assert.ok(!all.includes("market price"));
  });

  await check("scope ward -> limitation nói đúng phạm vi, KHÔNG dùng câu của province", () => {
    const listings = new MemListings();
    return listings.upsertMany([seedListing()]).then(() =>
      generatePriceIntelligence(CHECK, {
        gateway: fakeGateway(20, { n: 0 }),
        listings,
        stats: new MemStats(),
      }),
    ).then((r) => {
      assert.ok(r.ok);
      if (!r.ok) return;
      assert.equal(r.snapshot.scope_level, "ward");
      assert.ok(r.snapshot.limitations.includes(
        "Nhóm tham chiếu gồm tin cùng phường, cùng loại và diện tích tương đương.",
      ));
      assert.ok(!r.snapshot.limitations.includes(
        "Nhóm tham chiếu đang ở phạm vi rộng hơn do chưa xác định được khu vực chi tiết.",
      ));
    });
  });

  await check("không có tọa độ -> distance null, UI dùng nhãn trung tính", () => {
    const row: PriceStatsRow = {
      scope_key: "ward:1|cat:1010|size:na|rooms:na",
      stat_date: "2026-09-27",
      scope_level: "ward",
      scope_description: "Quận 6 · Căn hộ",
      region_name: "Tp Hồ Chí Minh",
      area_name: "Quận 6",
      category_code: 1010,
      size_min_m2: 27,
      size_max_m2: 72,
      rooms: 1,
      sample_size: 20,
      trimmed_size: 20,
      excluded_promoted: 0,
      excluded_invalid: 0,
      p25_ppm2: 1e8,
      median_ppm2: 1.5e8,
      p75_ppm2: 2e8,
      min_ppm2: 9e7,
      max_ppm2: 2.2e8,
      quality_score: 0.8,
      source: "chotot_gateway",
      computed_at: "2026-09-27T00:00:00.000Z",
    };
    const s = buildSnapshotFromRow({
      row,
      scope: SCOPE,
      check: CHECK,
      iso: "2026-09-27T00:00:00.000Z",
      comparables: [
        { external_id: "x1", title: null, size_m2: 45, price_vnd: 6e9, price_per_m2: 133333333, rooms: 2, distance_km: null, listed_at: null, url: null },
      ],
    });
    assert.equal(s.comparables[0].distance_km, null);
    assert.equal(DISTANCE_FALLBACK_LABEL, "Không có dữ liệu khoảng cách");
    assert.ok(
      !DISTANCE_FALLBACK_LABEL.includes("nhóm tham chiếu"),
      "nhãn khoảng cách không được mô tả bộ lọc",
    );
  });

  await check("lỗi DB lúc upsert -> throw PricePipelineError (mã an toàn, không lộ message)", async () => {
    class BrokenListings extends MemListings {
      override async upsertMany() {
        throw new PricePipelineError("listing_upsert_failed");
      }
    }
    const r = await generatePriceSafe(CHECK, {
      gateway: fakeGateway(50, { n: 0 }),
      listings: new BrokenListings(),
      stats: new MemStats(),
    });
    assert.equal(r, null, "pipeline ném lỗi ra -> route phải bắt được");
    assert.equal(safeErrorCode(new PricePipelineError("listing_upsert_failed")), "listing_upsert_failed");
  });

  await check("safeErrorCode phân loại đúng lỗi schema, không lộ message", () => {
    assert.equal(safeErrorCode({ code: "42703", message: 'column "x" does not exist' }), "schema_missing");
    assert.equal(safeErrorCode({ code: "PGRST204" }), "schema_missing");
    assert.equal(safeErrorCode({ code: "42501" }), "rls_denied");
    assert.equal(safeErrorCode({ code: "23505" }), "duplicate_key");
    assert.equal(safeErrorCode(new PricePipelineError("stats_upsert_failed")), "stats_upsert_failed");
    const aborter = new Error("aborted");
    aborter.name = "AbortError";
    assert.equal(safeErrorCode(aborter), "timeout");
    assert.equal(safeErrorCode(null), "unknown");
    // Không mã nào chứa message gốc
    for (const e of [{ code: "42703", message: "secret detail" }, new Error("boom")]) {
      assert.ok(!String(safeErrorCode(e)).includes("secret"));
      assert.ok(!String(safeErrorCode(e)).includes("boom"));
    }
  });

  await check("lỗi stats claim/upsert -> cũng là mã an toàn, message không lộ chi tiết DB", () => {
    const e = new PricePipelineError("stats_upsert_failed");
    assert.equal(e.code, "stats_upsert_failed");
    assert.equal(safeErrorCode(e), "stats_upsert_failed");
    // message chỉ chứa mã, không chứa message gốc của DB
    assert.ok(!e.message.includes("market_price_stats"));
    assert.ok(!e.message.includes("select"));
  });

  console.log("\n== Post-filter: so MÃ PHƯỜNG ở tầng phường, MÃ QUẬN ở tầng quận ==");

  // Gốc rễ sample_size=0 (sau khi scope đã lên được tầng phường): post-filter
  // cũ so listing.area_v2 (mã QUẬN 13101) với mã đang cần (mã PHƯỜNG) nên loạt
  // bỏ HẾT tin. Ở đây khẳng định: tầng phường so `ward`, tầng quận so `area_v2`.
  // rooms_min/max = null -> roomsPartitions trả [null] -> đúng 1 lần gọi gateway,
  // nên số tin thu được đếm trực tiếp, không bị nhân theo số phân vùng rooms.
  const WARD_SCOPE: PriceScope = {
    scope_level: "ward",
    scope_key: "ward:6885|cat:1010|size:40-106|rooms:na",
    scope_description: "Phường An Hải Bắc, Đà Nẵng · Căn hộ",
    region_name: "Đà Nẵng",
    area_name: "Phường An Hải Bắc",
    category_code: 1010,
    category_name: "Căn hộ",
    size_min_m2: 40,
    size_max_m2: 106,
    rooms_min: null,
    rooms_max: null,
  };

  function gatewayOf(ads: RawMarketAd[], seen: FetchScope[]): MarketGateway {
    return {
      source: "test",
      supportsPagination: false,
      maxItemsPerRequest: 50,
      async fetchListings(s) {
        seen.push(s);
        return ads;
      },
      async fetchTotal() {
        return null;
      },
      async resolveRegionCode() {
        return 3017;
      },
      async resolveAreaCodes() {
        return { areaCode: 6885, crawlAreaCode: 301704, level: "ward" as const };
      },
      async resolveAreaCode() {
        return 6885;
      },
    };
  }

  const daNangAd = (over: Partial<RawMarketAd>): RawMarketAd =>
    makeAd({
      region_v2: 3017,
      region_name: "Đà Nẵng",
      area_v2: 301704,
      area_name: "Quận Sơn Trà",
      ...over,
    });

  await check("tầng phường: giữ tin có ward khớp, bỏ tin ward khác", async () => {
    const seen: FetchScope[] = [];
    const gw = gatewayOf(
      [
        daNangAd({ ward: 6885 }),
        daNangAd({ ward: 6883 }),
        daNangAd({ ward: 6886 }),
      ],
      seen,
    );
    const out = await crawlScope({
      gateway: gw,
      scope: WARD_SCOPE,
      regionV2: 3017,
      areaV2: 6885, // mã PHƯỜNG -> dùng cho scope + post-filter
      crawlAreaV2: 301704, // mã QUẬN -> đưa vào tham số area_v2
      level: "ward",
    });
    assert.equal(out.listings.length, 1, "chỉ giữ đúng 1 tin thuộc phường 6885");
    assert.equal(seen[0].areaV2, 301704, "tham số area_v2 phải là mã QUẬN, không phải mã phường");
  });

  await check("tầng phường: tin không gắn ward thì bỏ và đếm, KHÔNG đoán", async () => {
    const gw = gatewayOf([daNangAd({}), daNangAd({ ward: 6885 })], []);
    const out = await crawlScope({
      gateway: gw,
      scope: WARD_SCOPE,
      regionV2: 3017,
      areaV2: 6885,
      crawlAreaV2: 301704,
      level: "ward",
    });
    assert.equal(out.listings.length, 1);
    assert.equal(out.droppedNoCode, 1, "phải báo số tin bị loại vì thiếu mã phường");
  });

  await check("tầng quận: vẫn so area_v2, giữ đúng nhóm quận", async () => {
    const seen: FetchScope[] = [];
    const gw = gatewayOf(
      [daNangAd({ ward: 6885 }), makeAd({ area_v2: 13101, area_name: "Quận 6", region_v2: 13000 })],
      seen,
    );
    const out = await crawlScope({
      gateway: gw,
      scope: { ...WARD_SCOPE, scope_level: "area", scope_key: "area:301704|cat:1010" },
      regionV2: 3017,
      areaV2: 301704,
      crawlAreaV2: 301704,
      level: "area",
    });
    assert.equal(out.listings.length, 1, "tầng quận so area_v2, KHÔNG so ward");
    assert.equal(seen[0].areaV2, 301704);
  });

  await check("tầng tỉnh: không lọc quận, không lọc phường", async () => {
    const seen: FetchScope[] = [];
    const gw = gatewayOf([daNangAd({ ward: 6885 }), daNangAd({ ward: 6886 })], seen);
    const out = await crawlScope({
      gateway: gw,
      scope: { ...WARD_SCOPE, scope_level: "province", scope_key: "province:3017|cat:1010" },
      regionV2: 3017,
      areaV2: null,
      crawlAreaV2: null,
      level: "area",
    });
    assert.equal(out.listings.length, 2, "tầng tỉnh giữ mọi tin trong tỉnh");
    assert.equal(seen[0].areaV2, null, "không được gửi area_v2 ở tầng tỉnh");
  });

  await check("sai tỉnh thì vẫn bị loại ở mọi cấp", async () => {
    const gw = gatewayOf([daNangAd({ region_v2: 13000, ward: 6885 })], []);
    const out = await crawlScope({
      gateway: gw,
      scope: WARD_SCOPE,
      regionV2: 3017,
      areaV2: 6885,
      crawlAreaV2: 301704,
      level: "ward",
    });
    assert.equal(out.listings.length, 0, "tin tỉnh khác không được lọt vào mẫu phường");
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  // process.exit() huy async handle -> libuv assertion tren Windows.
  // process.exitCode de tien trinh tu thoat, chay lai 100%
  process.exitCode = fail > 0 ? 1 : 0;
}

let lSeq = 0;
/** 1 tin "ấm" chỉ để có area_v2 trong index, không ảnh hưởng thống kê. */
function seedListing(): NormalizedListing {
  return mkL("seed", 1010, 50, 100_000_000);
}

function mkL(
  id: string,
  categoryCode: number,
  sizeM2: number,
  ppm2: number,
  geo: { lat: number; lng: number } | null = null,
): NormalizedListing {
  lSeq += 1;
  return {
    source: "chotot_gateway",
    external_id: id,
    category_code: categoryCode,
    category_name: categoryCode === 1000 ? "Đất" : "Nhà ở",
    region_name: "Tp Hồ Chí Minh",
    region_v2: 13000,
    area_name: "Quận 6",
    area_v2: 13101,
    title: `Tin ${id}`,
    price_vnd: Math.round((ppm2 * sizeM2) / 1e6) * 1e6,
    size_m2: sizeM2,
    living_size_m2: null,
    land_front_m: null,
    land_side_m: null,
    rooms: 3,
    price_per_m2: ppm2,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
    listed_at: null,
    url: null,
    is_price_valid: true,
    is_promoted: false,
    is_rent: false,
  };
}

main();
