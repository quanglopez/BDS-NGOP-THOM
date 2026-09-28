// Self-check: Price Intelligence Geo Resolver V2 (gazetteer) + tích hợp pipeline.
// Chạy: npm test — fake gateway/repo, không network, không DB.
import { strict as assert } from "node:assert";
import {
  createGeoResolver,
  inMemoryGeoAreaMap,
  type GeoAreaMapRepo,
  type GeoCodeRow,
} from "../lib/price/geo-resolver.ts";
import {
  generatePriceIntelligence,
  LIMITATION_WIDENED_FROM_WARD,
  type CheckInput,
  type PipelineDeps,
} from "../lib/price/pipeline.ts";
import type { MarketGateway, RawMarketAd, FetchScope } from "../lib/price/gateway.ts";
import type { MarketListingRepo, PriceStatsRepo } from "../lib/price/pipeline.ts";
import type { NormalizedListing, PriceScope, PriceStatsRow } from "../lib/price/types.ts";
import { detectCategoryCode } from "../lib/price/scope.ts";

const CHECK_TEXT = "Bán nhà Quận 6\nGiá 5 tỷ, diện tích 50m2";

// Category suy ra từ chính text của CHECK để fixture không lệch với bộ dò loại.
// Hard-code 1000 sẽ hỏng ngay khi bộ từ khoá đổi -> kept = 0 -> statistics null.
const CAT = detectCategoryCode(CHECK_TEXT) ?? 1000;

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

// ---------------------------------------------------------------- fixtures

let adSeq = 0;

/**
 * Fixture đúng shape RawMarketAd mà normalizer thật sự đọc:
 * list_id, category, subject, size + size_unit_string. Thiếu size_unit_string
 * thì size bị coi là 0 -> mọi tin bị loại -> statistics null.
 */
function makeAd(over: Partial<RawMarketAd> = {}): RawMarketAd {
  adSeq += 1;
  return {
    list_id: 800_000 + adSeq,
    type: "s",
    category: CAT,
    category_name: "Nhà đất",
    region_v2: 79,
    region_name: "Tp Hồ Chí Minh",
    area_v2: 13006,
    area_name: "Quận 6",
    subject: `Tin test ${adSeq}`,
    price: 5_000_000_000,
    size: 50,
    size_unit_string: "m²",
    rooms: 3,
    latitude: 10.75598,
    longitude: 106.62464,
    list_time: 1790499660369,
    ...over,
  } as RawMarketAd;
}

function fakeGateway(ads: RawMarketAd[], n: { crawl: number; region: number; area: number }): MarketGateway {
  return {
    source: "test",
    supportsPagination: false,
    maxItemsPerRequest: 50,
    async fetchListings(_scope: FetchScope) {
      n.crawl += 1;
      return ads;
    },
    async fetchTotal() {
      return null;
    },
    async resolveRegionCode(name: string) {
      n.region += 1;
      return name ? 79 : null;
    },
    async resolveAreaCodes(_r: string, area: string) {
      n.area += 1;
      return area
        ? { areaCode: 13006, crawlAreaCode: 13006, level: "area" as const }
        : null;
    },
    async resolveAreaCode(_r: string, area: string) {
      n.area += 1;
      return area ? 13006 : null;
    },
  };
}

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
  originalText: "Bán nhà Quận 6\nGiá 5 tỷ, diện tích 50m2",
  province: "Tp Hồ Chí Minh",
  regionName: "Tp Hồ Chí Minh",
  wardName: "Quận 6",
  priceVnd: 5_000_000_000,
  areaM2: 50,
  bedrooms: 3,
};

async function main() {
  // ================================================================
  // RESOLVER
  // ================================================================
  console.log("\n== Resolver: cache hit / miss / lỗi ==");

  await check("R1. cache hit -> KHÔNG gọi gateway", async () => {
    const repo = inMemoryGeoAreaMap([
      { regionKey: "ho chi minh", areaKey: "6", region_v2: 79, area_v2: 13006 , ward_v2: null},
    ]);
    const n = { crawl: 0, region: 0, area: 0 };
    const r = createGeoResolver({ repo, gateway: fakeGateway([], n) });
    const got = await r.resolveAreaCode("Tp Hồ Chí Minh", "Quận 6");
    assert.deepEqual(got, {
      areaCode: 13006,
      crawlAreaCode: 13006,
      level: "area",
      region_v2: 79,
      fromCache: true,
    });
    assert.equal(n.area, 0, "cache hit thì 0 lần gọi gateway");
    assert.equal(n.region, 0);
  });

  await check("R2. cache miss -> gọi gateway rồi LƯU cache", async () => {
    const repo = inMemoryGeoAreaMap();
    const n = { crawl: 0, region: 0, area: 0 };
    const r = createGeoResolver({ repo, gateway: fakeGateway([], n) });
    const got = await r.resolveAreaCode("Tp Hồ Chí Minh", "Quận 6");
    assert.equal(got?.areaCode, 13006);
    assert.equal(got?.fromCache, false);
    assert.equal(n.area, 1, "phải gọi gateway 1 lần");
    const saved = await repo.find("ho chi minh", "6");
    assert.equal(saved?.area_v2, 13006, "phải lưu vào cache");
    assert.equal(saved?.region_v2, 79);
  });

  await check("R3. Lần 2 -> cache hit, 0 gateway call (chứng minh cache hoạt động)", async () => {
    const repo = inMemoryGeoAreaMap();
    const n = { crawl: 0, region: 0, area: 0 };
    const r = createGeoResolver({ repo, gateway: fakeGateway([], n) });
    await r.resolveAreaCode("Tp Hồ Chí Minh", "Quận 6");
    assert.equal(n.area, 1);
    await r.resolveAreaCode("Tp Hồ Chí Minh", "Quận 6");
    assert.equal(n.area, 1, "lần sau phải đọc cache, không gọi lại gateway");
  });

  await check("R4. gateway trả null -> null, KHÔNG ghi cache", async () => {
    const repo = inMemoryGeoAreaMap();
    const n = { crawl: 0, region: 0, area: 0 };
    const r = createGeoResolver({
      repo,
      gateway: { resolveAreaCodes: async () => null, resolveRegionCode: async () => 79 },
    });
    const got = await r.resolveAreaCode("Tp Hồ Chí Minh", "Quận 6");
    assert.equal(got, null);
    assert.equal(await repo.find("ho chi minh", "6"), null, "không được ghi khi không chắc chắn");
  });

  await check("R5. gateway NÉM lỗi -> null, không throw ra ngoài", async () => {
    const r = createGeoResolver({
      repo: inMemoryGeoAreaMap(),
      gateway: {
        resolveAreaCodes: async () => {
          throw new Error("mạng chết");
        },
        resolveRegionCode: async () => 79,
      },
    });
    const got = await r.resolveAreaCode("Tp Hồ Chí Minh", "Quận 6");
    assert.equal(got, null, "lỗi mạng phải rơi về tầng tỉnh, không nổi lên");
  });

  await check("R6. cache ĐỌC lỗi -> vẫn hỏi gateway, không chết", async () => {
    const bad: GeoAreaMapRepo = {
      find: async () => {
        throw new Error("bảng chưa migrate");
      },
      save: async () => {},
    };
    const n = { crawl: 0, region: 0, area: 0 };
    const r = createGeoResolver({ repo: bad, gateway: fakeGateway([], n) });
    const got = await r.resolveAreaCode("Tp Hồ Chí Minh", "Quận 6");
    assert.equal(got?.areaCode, 13006, "thiếu bảng cache vẫn phải chạy được");
    assert.equal(n.area, 1);
  });

  await check("R7. cache GHI lỗi -> vẫn trả kết quả đã tra", async () => {
    const bad: GeoAreaMapRepo = {
      find: async () => null,
      save: async () => {
        throw new Error("RLS");
      },
    };
    const r = createGeoResolver({ repo: bad, gateway: fakeGateway([], { crawl: 0, region: 0, area: 0 }) });
    const got = await r.resolveAreaCode("Tp Hồ Chí Minh", "Quận 6");
    assert.equal(got?.areaCode, 13006, "ghi cache hỏng không được làm mất kết quả");
  });

  await check("R8. thiếu tên -> null, KHÔNG gọi gì", async () => {
    const n = { crawl: 0, region: 0, area: 0 };
    const r = createGeoResolver({ repo: inMemoryGeoAreaMap(), gateway: fakeGateway([], n) });
    assert.equal(await r.resolveAreaCode(null, "Quận 6"), null);
    assert.equal(await r.resolveAreaCode("Tp Hồ Chí Minh", null), null);
    assert.equal(await r.resolveAreaCode("", "  "), null);
    assert.equal(n.area, 0, "không có tên thì không gọi gateway");
    assert.equal(n.region, 0);
  });

  await check("R9. có regionV2Hint -> KHÔNG gọi resolveRegionCode", async () => {
    const n = { crawl: 0, region: 0, area: 0 };
    const r = createGeoResolver({ repo: inMemoryGeoAreaMap(), gateway: fakeGateway([], n) });
    const got = await r.resolveAreaCode("Tp Hồ Chí Minh", "Quận 6", { regionV2Hint: 79 });
    assert.equal(got?.region_v2, 79);
    assert.equal(n.region, 0, "đã có mã tỉnh thì khỏi hỏi lại gateway");
  });

  await check("R10. khoá cache là TÊN ĐÃ CHUẨN HOÁ", async () => {
    const repo = inMemoryGeoAreaMap();
    const r = createGeoResolver({ repo, gateway: fakeGateway([], { crawl: 0, region: 0, area: 0 }) });
    await r.resolveAreaCode("Tp Hồ Chí Minh", "Quận 6");
    const hit = await repo.find("ho chi minh", "6");
    assert.ok(hit, "khoá phải là chuỗn đã chuẩn hoá, không phải tên gốc");
  });

  await check("R11. cache SAI ĐỊNH DẠNG -> phải bỏ qua, hỏi gateway, KHÔNG trả rác", async () => {
    // Cache hỏng (migrate dở, tay sửa tay) là rất có thể xảy ra. Mã sai định dạng
    // KHÔNG được lọt vào scope — phải coi như cache miss.
    for (const bad of [null, undefined, NaN, "13006" as unknown as number, 0]) {
      const repo = inMemoryGeoAreaMap([
        { regionKey: "ho chi minh", areaKey: "6", region_v2: 79, area_v2: bad as number , ward_v2: null},
      ]);
      const n = { crawl: 0, region: 0, area: 0 };
      const r = createGeoResolver({ repo, gateway: fakeGateway([], n) });
      const got = await r.resolveAreaCode("Tp Hồ Chí Minh", "Quận 6");
      assert.equal(got?.areaCode, 13006, `area_v2=${String(bad)} phải bị loại, không được dùng`);
      assert.equal(got?.fromCache, false, `area_v2=${String(bad)} phải đi đường gateway`);
      assert.equal(n.area, 1, `area_v2=${String(bad)} phải gọi gateway`);
    }
  });

  await check("R12. cache cho region_v2 sai kiểu -> vẫn dùng được area_v2", async () => {
    const repo = inMemoryGeoAreaMap([
      {
        regionKey: "ho chi minh",
        areaKey: "6",
        region_v2: "79" as unknown as number,
        area_v2: 13006,
        ward_v2: null,
      },
    ]);
    const r = createGeoResolver({ repo, gateway: fakeGateway([], { crawl: 0, region: 0, area: 0 }) });
    const got = await r.resolveAreaCode("Tp Hồ Chí Minh", "Quận 6");
    assert.equal(got?.areaCode, 13006);
    assert.equal(got?.fromCache, true);
  });

  // ================================================================
  // PIPELINE
  // ================================================================
  console.log("\n== Pipeline: ward + resolver ==");

  const manyAds = Array.from({ length: 20 }, (_, i) => makeAd({ external_id: `g${i}` }));

  await check("P1. ward có + resolver OK -> scope_level = 'ward' (cold-start)", async () => {
    const n = { crawl: 0, region: 0, area: 0 };
    const geo = createGeoResolver({
      repo: inMemoryGeoAreaMap([{ regionKey: "ho chi minh", areaKey: "6", region_v2: 79, area_v2: 13006 , ward_v2: null}]),
      gateway: fakeGateway([], n),
    });
    const deps: PipelineDeps = {
      // Cố tình bỏ deps.gateway.resolveRegionCode trả về có ích:
      // index rỗng nên mã tỉnh phải đến từ geo cache.
      gateway: {
        ...fakeGateway(manyAds, n),
        resolveRegionCode: async () => 79,
      },
      listings: new MemListings(),
      stats: new MemStats(),
      geo,
    };
    const r = await generatePriceIntelligence(CHECK, deps);
    assert.ok(r.ok, "phải tạo được snapshot");
    if (!r.ok) return;
    assert.equal(r.snapshot.scope_level, "ward", "cold-start phải lên được tầng phường");
    assert.ok(r.snapshot.statistics, "phải có số liệu");
  });

  await check("P2. không có wardName -> KHÔNG gọi resolver, ra 'province'", async () => {
    const n = { crawl: 0, region: 0, area: 0 };
    const geo = createGeoResolver({ repo: inMemoryGeoAreaMap(), gateway: fakeGateway([], n) });
    const deps: PipelineDeps = {
      gateway: fakeGateway(manyAds, n),
      listings: new MemListings(),
      stats: new MemStats(),
      geo,
    };
    const r = await generatePriceIntelligence({ ...CHECK, wardName: null }, deps);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.snapshot.scope_level, "province");
    assert.equal(n.area, 0, "không có ward thì không được gọi resolver");
  });

  await check("P3. resolver trả null -> rơi về 'province', không nổi", async () => {
    const n = { crawl: 0, region: 0, area: 0 };
    const geo = createGeoResolver({
      repo: inMemoryGeoAreaMap(),
      gateway: { resolveAreaCodes: async () => null, resolveRegionCode: async () => 79 },
    });
    const deps: PipelineDeps = {
      gateway: { ...fakeGateway(manyAds, n), resolveRegionCode: async () => 79 },
      listings: new MemListings(),
      stats: new MemStats(),
      geo,
    };
    const r = await generatePriceIntelligence(CHECK, deps);
    assert.ok(r.ok, "phải vẫn tạo được snapshot ở tầng tỉnh");
    if (!r.ok) return;
    assert.equal(r.snapshot.scope_level, "province");
  });

  await check("P4. KHÔNG có deps.geo -> hành vi cũ, không lỗi", async () => {
    const n = { crawl: 0, region: 0, area: 0 };
    const deps: PipelineDeps = {
      gateway: fakeGateway(manyAds, n),
      listings: new MemListings(),
      stats: new MemStats(),
    };
    const r = await generatePriceIntelligence(CHECK, deps);
    assert.ok(r.ok);
  });

  // ================================================================
  // SAFETY: crawl phải nhận đúng area_v2
  // ================================================================
  console.log("\n== Safety: crawl nhận đúng mã, không gán nhầm nhãn ==");

  await check("S1. crawlScope phải nhận areaV2 đã tra V2", async () => {
    const seen: { areaV2: number | null; regionV2: number | null }[] = [];
    const n = { crawl: 0, region: 0, area: 0 };
    // Tin phải mang ĐÚNG mã mà cache trả, nếu không bộ lọc địa lý sẽ loại hết
    // (đúng, nhưng không còn kiểm được "crawl nhận mã nào").
    const CODE = 424242;
    const ads = manyAds.map((a) => makeAd({ area_v2: CODE }));
    const base = fakeGateway(ads, n);
    const deps: PipelineDeps = {
      gateway: {
        ...base,
        async fetchListings(s: FetchScope) {
          seen.push({ areaV2: s.areaV2 ?? null, regionV2: s.regionV2 ?? null });
          return base.fetchListings(s);
        },
        resolveRegionCode: async () => 79,
      },
      listings: new MemListings(),
      stats: new MemStats(),
      geo: createGeoResolver({
        repo: inMemoryGeoAreaMap([{ regionKey: "ho chi minh", areaKey: "6", region_v2: 79, area_v2: CODE , ward_v2: null}]),
        gateway: fakeGateway([], n),
      }),
    };
    const r = await generatePriceIntelligence(CHECK, deps);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.snapshot.scope_level, "ward");
    assert.ok(seen.length > 0, "phải có lần crawl");
    for (const c of seen) {
      assert.equal(c.areaV2, CODE, "crawl phải dùng mã V2 tra được, KHÔNG phải null");
      assert.equal(c.regionV2, 79, "crawl phải có mã tỉnh");
    }
  });

  await check("S2. mã V2 khác mã trong index -> vẫn dùng mã V2 cho crawl", async () => {
    // Index có area_v2=13006 nhưng V2 trả 777. Phải dùng 777.
    const CODE = 777;
    const ads = manyAds.map((a) => makeAd({ area_v2: CODE }));
    const seen: (number | null)[] = [];
    const n = { crawl: 0, region: 0, area: 0 };
    const base = fakeGateway(ads, n);
    const deps: PipelineDeps = {
      gateway: {
        ...base,
        async fetchListings(s: FetchScope) {
          seen.push(s.areaV2 ?? null);
          return base.fetchListings(s);
        },
        resolveRegionCode: async () => 79,
      },
      listings: new MemListings(),
      stats: new MemStats(),
      geo: createGeoResolver({
        repo: inMemoryGeoAreaMap([{ regionKey: "ho chi minh", areaKey: "6", region_v2: 79, area_v2: CODE , ward_v2: null}]),
        gateway: fakeGateway([], n),
      }),
    };
    const r = await generatePriceIntelligence(CHECK, deps);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.snapshot.scope_level, "ward", "phải lên tầng phường, không rơi tỉnh");
    assert.ok(seen.every((v) => v === CODE), `phải dùng mã V2, thấy: ${seen.join(",")}`);
  });

  await check("S4. gateway trả tin SAI phường -> phải loại, không tính vào thống kê", async () => {
    // Gateway có thể trả nhiễm dù đã lọc. Nếu tin của phường khác lọt vào
    // sample thì số liệu "cùng phường" là bịa — đúng thứ phải chặn.
    const mixed = [
      ...Array.from({ length: 20 }, (_, i) => makeAd({ list_id: 900_000 + i, area_name: "Quận 6", area_v2: 13006 })),
      ...Array.from({ length: 5 }, (_, i) => makeAd({ list_id: 950_000 + i, area_name: "Quận 1", area_v2: 13001 })),
    ];
    const n = { crawl: 0, region: 0, area: 0 };
    const r = await generatePriceIntelligence(CHECK, {
      gateway: { ...fakeGateway(mixed, n), resolveRegionCode: async () => 79 },
      listings: new MemListings(),
      stats: new MemStats(),
      geo: createGeoResolver({
        repo: inMemoryGeoAreaMap([{ regionKey: "ho chi minh", areaKey: "6", region_v2: 79, area_v2: 13006 , ward_v2: null}]),
        gateway: fakeGateway([], n),
      }),
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.snapshot.scope_level, "ward");
    assert.equal(r.snapshot.sample_size, 20, "chỉ được tính 20 tin Quận 6, loại 5 tin Quận 1");
  });

  await check("S5. gateway trả tin sai TỈNH -> phải loại", async () => {
    const mixed = [
      ...Array.from({ length: 20 }, (_, i) => makeAd({ list_id: 960_000 + i, region_name: "Tp Hồ Chí Minh", region_v2: 79 })),
      ...Array.from({ length: 4 }, (_, i) => makeAd({ list_id: 970_000 + i, region_name: "Hà Nội", region_v2: 44 })),
    ];
    const n = { crawl: 0, region: 0, area: 0 };
    const r = await generatePriceIntelligence({ ...CHECK, wardName: null }, {
      gateway: { ...fakeGateway(mixed, n), resolveRegionCode: async () => 79 },
      listings: new MemListings(),
      stats: new MemStats(),
      geo: createGeoResolver({ repo: inMemoryGeoAreaMap(), gateway: fakeGateway([], n) }),
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.snapshot.sample_size, 20, "chỉ được tính 20 tin TP.HCM, loại 4 tin Hà Nội");
  });

  await check("S6. tin KHÔNG có mã địa lý -> vẫn giữ (không chứng minh được là sai)", async () => {
    // Gateway có thể không trả region_v2/area_v2. Loại hết sẽ khiến tầng phường
    // luôn rỗng -> V2 không bao giờ dùng được. Nên giữ, chỉ loại khi mã mâu thuẫn.
    const noCode = Array.from({ length: 20 }, (_, i) =>
      makeAd({ list_id: 980_000 + i, area_v2: null as unknown as number }),
    );
    const n = { crawl: 0, region: 0, area: 0 };
    const r = await generatePriceIntelligence(CHECK, {
      gateway: { ...fakeGateway(noCode, n), resolveRegionCode: async () => 79 },
      listings: new MemListings(),
      stats: new MemStats(),
      geo: createGeoResolver({
        repo: inMemoryGeoAreaMap([{ regionKey: "ho chi minh", areaKey: "6", region_v2: 79, area_v2: 13006 , ward_v2: null}]),
        gateway: fakeGateway([], n),
      }),
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.snapshot.scope_level, "ward");
    assert.equal(r.snapshot.sample_size, 20, "tin không mã vẫn phải được giữ");
  });

  await check("S3. scope_key của ward khác tỉnh, không trùng nhau", async () => {    const n = { crawl: 0, region: 0, area: 0 };
    const stats = new MemStats();
    const geo = createGeoResolver({
      repo: inMemoryGeoAreaMap([{ regionKey: "ho chi minh", areaKey: "6", region_v2: 79, area_v2: 13006 , ward_v2: null}]),
      gateway: fakeGateway([], n),
    });
    const gw = { ...fakeGateway(manyAds, n), resolveRegionCode: async () => 79 };
    const ward = await generatePriceIntelligence(CHECK, {
      gateway: gw,
      listings: new MemListings(),
      stats,
      geo,
    });
    const prov = await generatePriceIntelligence({ ...CHECK, wardName: null }, {
      gateway: gw,
      listings: new MemListings(),
      stats,
      geo,
    });
    assert.ok(ward.ok && prov.ok);
    if (!ward.ok || !prov.ok) return;
    assert.notEqual(ward.snapshot.scope.scope_key, prov.snapshot.scope.scope_key);
  });

  // ================================================================
  // PHASE 5: thiếu mẫu ở phường -> mở rộng tỉnh + limitation
  // ================================================================
  console.log("\n== PHASE 5: thiếu mẫu ở phường ==");

  // 3 tin ở phường (dưới MIN_SAMPLE_SIZE=15), 20 tin ở tỉnh.
  const fewWardAds = [
    makeAd({ external_id: "w1", area_name: "Quận 6", area_v2: 13006 }),
    makeAd({ external_id: "w2", area_name: "Quận 6", area_v2: 13006 }),
    makeAd({ external_id: "w3", area_name: "Quận 6", area_v2: 13006 }),
  ];
  const provinceAds = Array.from({ length: 20 }, (_, i) =>
    makeAd({ external_id: `p${i}`, area_name: i === 0 ? "Quận 6" : "Quận 1", area_v2: i === 0 ? 13006 : 13001 }),
  );

  /** Gateway trả ít khi có areaV2, nhiều khi chỉ lọc tỉnh. */
  function tierGateway(n: { crawl: number; region: number; area: number }): MarketGateway {
    return {
      source: "test",
      supportsPagination: false,
      maxItemsPerRequest: 50,
      async fetchListings(s: FetchScope) {
        n.crawl += 1;
        return s.areaV2 != null ? fewWardAds : provinceAds;
      },
      async fetchTotal() {
        return null;
      },
      async resolveRegionCode() {
        n.region += 1;
        return 79;
      },
      async resolveAreaCodes() {
        n.area += 1;
        return { areaCode: 13006, crawlAreaCode: 13006, level: "area" as const };
      },
      async resolveAreaCode() {
        n.area += 1;
        return 13006;
      },
    };
  }

  await check("P5. ward thiếu mẫu + tỉnh đủ mẫu -> snapshot 'province' + limitation", async () => {
    const n = { crawl: 0, region: 0, area: 0 };
    const r = await generatePriceIntelligence(CHECK, {
      gateway: tierGateway(n),
      listings: new MemListings(),
      stats: new MemStats(),
      geo: createGeoResolver({
        repo: inMemoryGeoAreaMap([{ regionKey: "ho chi minh", areaKey: "6", region_v2: 79, area_v2: 13006 , ward_v2: null}]),
        gateway: fakeGateway([], n),
      }),
    });
    assert.ok(r.ok, "phải vẫn tạo được snapshot");
    if (!r.ok) return;
    assert.equal(r.snapshot.scope_level, "province", "phải mở rộng sang tỉnh");
    assert.ok(r.snapshot.statistics, "tầng tỉnh đủ mẫu thì phải có số");
    assert.ok(
      r.snapshot.limitations.includes(LIMITATION_WIDENED_FROM_WARD),
      `phải ghi limitation mở rộng, thấy: ${r.snapshot.limitations.join(" | ")}`,
    );
  });

  await check("P5b. limitation mở rộng KHÔNG nói dối 'chưa xác định được khu vực'", async () => {
    const n = { crawl: 0, region: 0, area: 0 };
    const r = await generatePriceIntelligence(CHECK, {
      gateway: tierGateway(n),
      listings: new MemListings(),
      stats: new MemStats(),
      geo: createGeoResolver({
        repo: inMemoryGeoAreaMap([{ regionKey: "ho chi minh", areaKey: "6", region_v2: 79, area_v2: 13006 , ward_v2: null}]),
        gateway: fakeGateway([], n),
      }),
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    // Cả hai đều là province, nhưng lý do KHÁC nhau -> limitation phải phân biệt.
    const lies = "chưa xác định được khu vực chi tiết";
    assert.ok(
      r.snapshot.limitations.some((l) => l.includes(lies)),
      "mở rộng từ phường thì KHÔNG được dùng limitation 'chưa xác định được khu vực'",
    );
  });

  await check("P5c. ward VÀ tỉnh đều thiếu mẫu -> giữ 'ward' với statistics=null", async () => {
    const thin: MarketGateway = {
      source: "test",
      supportsPagination: false,
      maxItemsPerRequest: 50,
      async fetchListings() {
        return fewWardAds; // luôn thiếu mẫu
      },
      async fetchTotal() {
        return null;
      },
      async resolveRegionCode() {
        return 79;
      },
      async resolveAreaCodes() {
        return { areaCode: 13006, crawlAreaCode: 13006, level: "area" as const };
      },
      async resolveAreaCode() {
        return 13006;
      },
    };
    const r = await generatePriceIntelligence(CHECK, {
      gateway: thin,
      listings: new MemListings(),
      stats: new MemStats(),
      geo: createGeoResolver({
        repo: inMemoryGeoAreaMap([{ regionKey: "ho chi minh", areaKey: "6", region_v2: 79, area_v2: 13006 , ward_v2: null}]),
        gateway: fakeGateway([], { crawl: 0, region: 0, area: 0 }),
      }),
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.snapshot.scope_level, "ward", "không mở rộng được thì giữ phường");
    assert.equal(r.snapshot.statistics, null, "KHÔNG được dựng số khi thiếu mẫu");
    assert.ok(
      !r.snapshot.limitations.includes(LIMITATION_WIDENED_FROM_WARD),
      "không mở rộng được thì không được ghi limitation mở rộng",
    );
  });

  // ================================================================
  // SAFETY: snapshot bất biến
  // ================================================================
  console.log("\n== Safety: tính bất biến của hàm (KHÔNG phải guard ghi snapshot của route) ==");

  await check("P6. cùng deps + cùng dữ liệu -> snapshot giống nhau (tính bất biến của hàm)", async () => {
    // generatePriceIntelligence chỉ trả snapshot; việc ghi thuộc route.
    // Test này chỉ chứng minh: gọi lại với cùng deps không sinh scope mới bất thường.
    const n = { crawl: 0, region: 0, area: 0 };
    const geo = createGeoResolver({
      repo: inMemoryGeoAreaMap([{ regionKey: "ho chi minh", areaKey: "6", region_v2: 79, area_v2: 13006 , ward_v2: null}]),
      gateway: fakeGateway([], n),
    });
    const deps: PipelineDeps = {
      gateway: { ...fakeGateway(manyAds, n), resolveRegionCode: async () => 79 },
      listings: new MemListings(),
      stats: new MemStats(),
      geo,
    };
    const a1 = await generatePriceIntelligence(CHECK, deps);
    const a2 = await generatePriceIntelligence(CHECK, deps);
    assert.ok(a1.ok && a2.ok);
    if (!a1.ok || !a2.ok) return;
    // Cùng scope + cùng dữ liệu -> snapshot giống nhau (trừ timestamp sinh)
    assert.equal(a1.snapshot.scope.scope_key, a2.snapshot.scope.scope_key);
    assert.equal(a1.snapshot.scope_level, a2.snapshot.scope_level);
    assert.deepEqual(a1.snapshot.statistics, a2.snapshot.statistics);
  });

  await check("P7. scope_key có mã V2 -> 2 lần chạy cho cùng scope, không tạo thêm scope", async () => {
    const n = { crawl: 0, region: 0, area: 0 };
    const stats = new MemStats();
    const deps: PipelineDeps = {
      gateway: { ...fakeGateway(manyAds, n), resolveRegionCode: async () => 79 },
      listings: new MemListings(),
      stats,
      geo: createGeoResolver({
        repo: inMemoryGeoAreaMap([{ regionKey: "ho chi minh", areaKey: "6", region_v2: 79, area_v2: 13006 , ward_v2: null}]),
        gateway: fakeGateway([], n),
      }),
    };
    await generatePriceIntelligence(CHECK, deps);
    const after1 = stats.rows.size;
    await generatePriceIntelligence(CHECK, deps);
    assert.equal(stats.rows.size, after1, "chạy lại phải dùng đường nhanh, không thêm hàng thống kê");
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
