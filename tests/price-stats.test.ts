// Self-check: price-v1 — thống kê, data quality, confidence. Chạy: npm test
// Hàm thuần, không mạng, không DB.
import { strict as assert } from "node:assert";
import {
  calcPpm2,
  classifyListing,
  computeStats,
  confidenceFrom,
  differencePercent,
  emptyExclusionCounts,
  filterSample,
  percentile,
  qualityScore,
  trimIqr,
} from "../lib/price/stats.ts";
import { MIN_SAMPLE_SIZE, PPM2_MAX, PPM2_MIN, type NormalizedListing, type PriceScope } from "../lib/price/types.ts";

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

const SCOPE: PriceScope = {
  scope_level: "ward",
  scope_key: "ward:1|cat:1020|size:48-128|rooms:2-4",
  scope_description: "Phường X, Quận Y · Nhà ở",
  region_name: "TP HCM",
  area_name: "Quận 6",
  category_code: 1020,
  category_name: "Nhà ở",
  size_min_m2: 48,
  size_max_m2: 128,
  rooms_min: 2,
  rooms_max: 4,
};

let seq = 0;
function mk(over: Partial<NormalizedListing> = {}): NormalizedListing {
  seq += 1;
  const price = over.price_vnd ?? 5_000_000_000;
  const size = over.size_m2 ?? 100;
  return {
    source: "chotot_gateway",
    external_id: `id${seq}`,
    category_code: 1020,
    category_name: "Nhà ở",
    region_name: "TP HCM",
    region_v2: 13000,
    area_name: "Quận 6",
    area_v2: 13101,
    title: "Tin test",
    price_vnd: price,
    size_m2: size,
    living_size_m2: null,
    land_front_m: null,
    land_side_m: null,
    rooms: 3,
    price_per_m2: calcPpm2(price, size)!,
    lat: null,
    lng: null,
    listed_at: null,
    url: null,
    is_price_valid: true,
    is_promoted: false,
    is_rent: false,
    ...over,
  };
}

/** n tin hợp lệ, ppm2 trải đều quanh median. Giá giữ nguyên chính xác (VND). */
function validSample(n: number, centerPpm2 = 100_000_000): NormalizedListing[] {
  const out: NormalizedListing[] = [];
  for (let i = 0; i < n; i += 1) {
    const ppm2 = centerPpm2 + (i - (n - 1) / 2) * 500_000;
    out.push(mk({ price_vnd: Math.round(ppm2 * 100), size_m2: 100 }));
  }
  return out;
}

async function main() {
  console.log("\n== calcPpm2 (tinh lai, khong dung gia tri cua gateway) ==");

  await check("tính đúng; thiếu/sai 0 -> null", () => {
    assert.equal(calcPpm2(5_000_000_000, 100), 50_000_000);
    assert.equal(calcPpm2(null, 100), null);
    assert.equal(calcPpm2(5_000_000_000, null), null);
    assert.equal(calcPpm2(0, 100), null);
    assert.equal(calcPpm2(5_000_000_000, 0), null);
    assert.equal(calcPpm2(5_000_000_000, -10), null);
  });

  console.log("\n== Data quality: loại đúng lý do ==");

  await check("tin cho thuê -> rent", () => {
    assert.equal(classifyListing(mk({ is_rent: true }), SCOPE), "rent");
  });

  await check("is_price_not_valid -> invalid_price_flag", () => {
    assert.equal(classifyListing(mk({ is_price_valid: false }), SCOPE), "invalid_price_flag");
  });

  await check("size <= 0 -> invalid_size; price <= 0 -> invalid_price", () => {
    assert.equal(classifyListing(mk({ size_m2: 0, price_per_m2: 1 }), SCOPE), "invalid_size");
    assert.equal(classifyListing(mk({ price_vnd: 0, price_per_m2: 1 }), SCOPE), "invalid_price");
  });

  await check("sai loại BĐS -> category_mismatch (gateway rò cg)", () => {
    assert.equal(classifyListing(mk({ category_code: 1000 }), SCOPE), "category_mismatch");
  });

  await check("tin quảng cáo -> promoted, vẫn còn trong luồng để lưu cache", () => {
    assert.equal(classifyListing(mk({ is_promoted: true }), SCOPE), "promoted");
    const raw = mk({ is_promoted: true, external_id: "promo1" });
    const r = filterSample([raw], SCOPE);
    assert.equal(r.kept.length, 0, "không tính vào thống kê");
    assert.equal(r.excluded.promoted, 1);
    assert.equal(raw.external_id, "promo1", "tin vẫn được trả về cho bước upsert");
  });

  await check("ppm2 ngoài [5tr, 2 tỷ] -> ppm2_out_of_range", () => {
    const low = mk({ price_vnd: 1_000_000, size_m2: 100, price_per_m2: 10_000 });
    const high = mk({ price_vnd: 500_000_000_000, size_m2: 100, price_per_m2: 5_000_000_000 });
    assert.ok(low.price_per_m2 < PPM2_MIN && high.price_per_m2 > PPM2_MAX);
    assert.equal(classifyListing(low, SCOPE), "ppm2_out_of_range");
    assert.equal(classifyListing(high, SCOPE), "ppm2_out_of_range");
  });

  await check("ngoài band diện tích -> size_out_of_band", () => {
    assert.equal(classifyListing(mk({ size_m2: 30 }), SCOPE), "size_out_of_band");
    assert.equal(classifyListing(mk({ size_m2: 200 }), SCOPE), "size_out_of_band");
  });

  await check("ngoài band phòng -> rooms_out_of_band; thiếu rooms cũng loại", () => {
    assert.equal(classifyListing(mk({ rooms: 1 }), SCOPE), "rooms_out_of_band");
    assert.equal(classifyListing(mk({ rooms: 5 }), SCOPE), "rooms_out_of_band");
    assert.equal(classifyListing(mk({ rooms: null }), SCOPE), "rooms_out_of_band");
  });

  await check("trùng external_id -> giữ 1, đếm duplicate", () => {
    const r = filterSample([mk({ external_id: "dup" }), mk({ external_id: "dup" })], SCOPE);
    assert.equal(r.kept.length, 1);
    assert.equal(r.duplicates, 1);
  });

  await check("emptyExclusionCounts đủ 10 nhóm", () => {
    assert.equal(Object.keys(emptyExclusionCounts()).length, 10);
  });

  console.log("\n== Thống kê: median, percentile, IQR ==");

  await check("percentile nội suy đúng trên tập lẻ và chẵn", () => {
    assert.equal(percentile([10, 20], 0.5), 15);
    assert.equal(percentile([10, 20, 30], 0.5), 20);
    assert.equal(percentile([0, 10, 20, 30, 40], 0.25), 10);
    assert.equal(percentile([], 0.5), null);
    assert.equal(percentile([7], 0.9), 7);
  });

  await check("median + p25/p75 đúng (nội suy trên 21 giá trị cách đều 0.5tr)", () => {
    const r = computeStats({ filtered: filterSample(validSample(21), SCOPE), scopeLevel: "ward" });
    assert.ok(r.statistics);
    assert.equal(r.statistics!.p25_ppm2, 97_500_000);
    assert.equal(r.statistics!.median_ppm2, 100_000_000);
    assert.equal(r.statistics!.p75_ppm2, 102_500_000);
    assert.equal(r.statistics!.min_ppm2, 95_000_000);
    assert.equal(r.statistics!.max_ppm2, 105_000_000);
  });

  await check("KHÔNG dùng mean: thêm 1 tin cực đại không đổi median", () => {
    const base = validSample(20);
    const withOutlier = [
      ...base,
      mk({ price_vnd: 400_000_000_000, size_m2: 100, price_per_m2: 4_000_000_000 }),
    ];
    const a = computeStats({ filtered: filterSample(base, SCOPE), scopeLevel: "ward" });
    const b = computeStats({ filtered: filterSample(withOutlier, SCOPE), scopeLevel: "ward" });
    assert.equal(b.sample_size, a.sample_size, "tin rác bị loại ở tầng lọc");
    assert.equal(b.statistics!.median_ppm2, a.statistics!.median_ppm2);
    assert.equal(b.excluded.ppm2_out_of_range, 1);
  });

  await check("mẫu đều -> IQR=0 -> giữ hết, trimmed = sample", () => {
    const r = computeStats({ filtered: filterSample(validSample(20), SCOPE), scopeLevel: "ward" });
    assert.equal(r.trimmed_size, r.sample_size);
  });

  await check("IQR=0 giữ hết, không xoá sạch", () => {
    assert.equal(trimIqr([50, 50, 50, 50]).kept.length, 4);
  });

  console.log("\n== Ngưỡng mẫu tối thiểu ==");

  await check(`sample < ${MIN_SAMPLE_SIZE} -> statistics null (không tạo số)`, () => {
    const r = computeStats({ filtered: filterSample(validSample(MIN_SAMPLE_SIZE - 1), SCOPE), scopeLevel: "ward" });
    assert.equal(r.sample_size, MIN_SAMPLE_SIZE - 1);
    assert.equal(r.statistics, null);
  });

  await check(`sample = ${MIN_SAMPLE_SIZE} -> có statistics`, () => {
    const r = computeStats({ filtered: filterSample(validSample(MIN_SAMPLE_SIZE), SCOPE), scopeLevel: "ward" });
    assert.equal(r.sample_size, MIN_SAMPLE_SIZE);
    assert.ok(r.statistics);
    assert.equal(typeof r.statistics!.median_ppm2, "number");
  });

  console.log("\n== Confidence (quy tắc đơn giản đã duyệt) ==");

  await check("ward + >=30 -> high; ward 15-29 -> medium", () => {
    assert.equal(confidenceFrom({ scopeLevel: "ward", trimmed: 30 }), "high");
    assert.equal(confidenceFrom({ scopeLevel: "ward", trimmed: 45 }), "high");
    assert.equal(confidenceFrom({ scopeLevel: "ward", trimmed: 29 }), "medium");
    assert.equal(confidenceFrom({ scopeLevel: "ward", trimmed: 15 }), "medium");
  });

  await check("province + >=30 -> medium; còn lại -> low", () => {
    assert.equal(confidenceFrom({ scopeLevel: "province", trimmed: 30 }), "medium");
    assert.equal(confidenceFrom({ scopeLevel: "province", trimmed: 100 }), "medium");
    assert.equal(confidenceFrom({ scopeLevel: "province", trimmed: 29 }), "low");
    assert.equal(confidenceFrom({ scopeLevel: "ward", trimmed: 14 }), "low");
  });

  await check("quality_score trong [0,1], province thấp hơn ward cùng mẫu", () => {
    const w = qualityScore({ trimmed: 30, sample: 30, scopeLevel: "ward" })!;
    const p = qualityScore({ trimmed: 30, sample: 30, scopeLevel: "province" })!;
    assert.ok(w >= 0 && w <= 1 && p >= 0 && p <= 1);
    assert.ok(w > p);
    assert.equal(qualityScore({ trimmed: 0, sample: 0, scopeLevel: "ward" }), null);
  });

  await check("confidence chỉ phụ thuộc scope + trimmed, không phụ thuộc mẫu gốc", () => {
    // 60 tin nhưng chỉ 30 giá trị hợp lệ sau trim -> vẫn high
    const raw = [...validSample(30), ...Array(30).fill(null).map(() => mk({ is_promoted: true }))];
    const r = computeStats({ filtered: filterSample(raw, SCOPE), scopeLevel: "ward" });
    assert.equal(r.trimmed_size, 30);
    assert.equal(confidenceFrom({ scopeLevel: "ward", trimmed: r.trimmed_size }), "high");
  });

  console.log("\n== difference_percent ==");

  await check("chênh lệch đúng dấu cả 2 chiều", () => {
    assert.equal(differencePercent(80_000_000, 100_000_000), -20);
    assert.equal(differencePercent(120_000_000, 100_000_000), 20);
    assert.equal(differencePercent(100_000_000, 100_000_000), 0);
  });

  await check("thiếu median hoặc target -> null", () => {
    assert.equal(differencePercent(100_000_000, null), null);
    assert.equal(differencePercent(null, 100_000_000), null);
    assert.equal(differencePercent(100_000_000, 0), null);
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  // process.exit() huy async handle -> libuv assertion tren Windows.
  // process.exitCode de tien trinh tu thoat, chay lai 100%
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
