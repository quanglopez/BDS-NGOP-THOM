// Self-check: price-v1 — dò loại BĐS, band, scope 2 tầng, khoảng cách. Chạy: npm test
import { strict as assert } from "node:assert";
import {
  CATEGORY,
  buildRoomsBand,
  buildScopeKey,
  buildSizeBand,
  detectCategoryCode,
  resolveScope,
  type WardIndex,
} from "../lib/price/scope.ts";
import { haversineKm } from "../lib/geo/distance.ts";

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

/** Fake index. Bỏ dấu trước khi so khớp — giống cách lớp DB sẽ làm. */
function deaccent(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function index(over: Partial<WardIndex> = {}): WardIndex {
  return {
    findAreaV2: (areaName) =>
      deaccent(areaName).includes("phuong 13") ? { areaV2: 13101, areaName } : null,
    findRegionV2: (regionName) => (regionName === "Vũng Tàu" ? 13023 : null),
    ...over,
  };
}

async function main() {
  console.log("\n== detectCategoryCode: thận trọng, không đoán ==");

  await check("căn hộ / chung cư -> 1010", () => {
    assert.equal(detectCategoryCode("Bán căn hộ 2 phòng ngủ Vincom"), CATEGORY.can_ho);
    assert.equal(detectCategoryCode("Bán chung cư quận 1"), CATEGORY.can_ho);
  });

  await check("đất nền -> 1000", () => {
    assert.equal(detectCategoryCode("Bán đất nền 200m2 mặt tiền"), CATEGORY.dat);
  });

  await check("nhà phố / biệt thự -> 1020", () => {
    assert.equal(detectCategoryCode("Bán nhà phố 4 tầng hẻm xe hơi"), CATEGORY.nha_o);
    assert.equal(detectCategoryCode("Bán biệt thự ven biển"), CATEGORY.nha_o);
  });

  await check("không rõ -> null (KHÔNG default 1020)", () => {
    assert.equal(detectCategoryCode("Bán nghi đẹp 5 tỷ"), null);
    assert.equal(detectCategoryCode(""), null);
    assert.equal(detectCategoryCode(null), null);
  });

  await check("mơ hồ giữa 2 loại -> null", () => {
    // có cả từ khóa đất lẫn nhà ở ở mức ngang nhau -> không chắc
    const r = detectCategoryCode("Bán nhà đất 100m2 giá 3 tỷ");
    assert.equal(r, null, "không được đoán khi hai loại ngang nhau");
  });

  await check("tiêu đề rõ loại -> thắng dù thân tin có nhắc loại khác", () => {
    // Dòng đầu ghi rõ "căn hộ" -> tin là căn hộ, phần mô tả có "nhà ở" không quan trọng
    const text = "Bán căn hộ 2 phòng ngủ Vincom\nQuận 7, khu vực nhà ở sầm uất, view sông";
    assert.equal(detectCategoryCode(text), CATEGORY.can_ho);
  });

  await check("mơ hồ ngay ở tiêu đề -> null, KHÔNG đoán", () => {
    assert.equal(detectCategoryCode("Bán căn hộ 2pn nhà ở quận 7"), null);
  });

  await check("chỉ từ khóa chung, đúng một loại -> nhận loại đó", () => {
    assert.equal(detectCategoryCode("Bán nhà 5 tầng, cần bán gấp, hẻm xe hơi"), CATEGORY.nha_o);
    assert.equal(detectCategoryCode("Bán lô đất vuông 200m2"), CATEGORY.dat);
  });

  await check("tiêu đề nhiều dòng: chỉ dòng đầu", () => {
    const text = "Bán căn hộ\n\n" + Array(30).fill("nhà ở đất nền căn hộ").join(" ");
    assert.equal(detectCategoryCode(text), CATEGORY.can_ho, "tiêu đề quyết định");
  });

  console.log("\n== Band diện tích & phòng ==");

  await check("band diện tích 0.6x .. 1.6x, lưu vào scope", () => {
    assert.deepEqual(buildSizeBand(100), { min: 60, max: 160 });
    assert.deepEqual(buildSizeBand(45), { min: 27, max: 72 });
    assert.deepEqual(buildSizeBand(7), { min: 4, max: 11 });
  });

  await check("thiếu diện tích -> không lọc", () => {
    assert.deepEqual(buildSizeBand(null), { min: null, max: null });
    assert.deepEqual(buildSizeBand(0), { min: null, max: null });
  });

  await check("band phòng = bedrooms±1, sàn tối thiểu 1", () => {
    assert.deepEqual(buildRoomsBand(2), { min: 1, max: 3 });
    assert.deepEqual(buildRoomsBand(3), { min: 2, max: 4 });
    assert.deepEqual(buildRoomsBand(1), { min: 1, max: 2 });
    assert.equal(buildRoomsBand(1).min, 1, "không xuống dưới 1");
  });

  await check("không có bedrooms -> KHÔNG lọc rooms", () => {
    assert.deepEqual(buildRoomsBand(null), { min: null, max: null });
    assert.deepEqual(buildRoomsBand(0), { min: null, max: null });
  });

  console.log("\n== scope_key ==");

  await check("cùng input -> cùng key (ổn định, dùng làm cache)", () => {
    const a = buildScopeKey({ scopeLevel: "ward", geoCode: 13101, categoryCode: 1020, sizeMin: 27, sizeMax: 72, roomsMin: 2, roomsMax: 4 });
    const b = buildScopeKey({ scopeLevel: "ward", geoCode: 13101, categoryCode: 1020, sizeMin: 27, sizeMax: 72, roomsMin: 2, roomsMax: 4 });
    assert.equal(a, b);
    assert.equal(a, "ward:13101|cat:1020|size:27-72|rooms:2-4");
  });

  await check("khác loại BĐS -> key khác, không lẫn mẫu", () => {
    const a = buildScopeKey({ scopeLevel: "ward", geoCode: 13101, categoryCode: 1020, sizeMin: 27, sizeMax: 72, roomsMin: 2, roomsMax: 4 });
    const b = buildScopeKey({ scopeLevel: "ward", geoCode: 13101, categoryCode: 1000, sizeMin: 27, sizeMax: 72, roomsMin: 2, roomsMax: 4 });
    assert.notEqual(a, b);
  });

  await check("thiếu band -> 'na' thay vì key lủng củng", () => {
    const k = buildScopeKey({ scopeLevel: "province", geoCode: 13023, categoryCode: 1020, sizeMin: null, sizeMax: null, roomsMin: null, roomsMax: null });
    assert.equal(k, "province:13023|cat:1020|size:na|rooms:na");
  });

  console.log("\n== resolveScope: 2 tầng ==");

  await check("thiếu loại BĐS -> not_enough_data, KHÔNG crawl", () => {
    const r = resolveScope(
      { categoryCode: null, regionName: "Vũng Tàu", wardName: "Phường 13", regionV2: 13023, areaM2: 45, bedrooms: 3 },
      index(),
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.reason.includes("loại bất động sản"), `reason=${r.reason}`);
    }
  });

  await check("có ward + tra được mã -> Tier 1 'ward'", () => {
    const r = resolveScope(
      { categoryCode: 1020, regionName: "Vũng Tàu", wardName: "Phường 13", regionV2: 13023, areaM2: 45, bedrooms: 3 },
      index(),
    );
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.tier, 1);
      assert.equal(r.scope.scope_level, "ward");
      assert.equal(r.scope.size_min_m2, 27);
      assert.equal(r.scope.size_max_m2, 72);
      assert.equal(r.scope.rooms_min, 2);
      assert.equal(r.scope.rooms_max, 4);
      assert.ok(r.scope.scope_description.includes("Nhà ở"));
    }
  });

  await check("không tra được ward -> Tier 2 'province'", () => {
    const r = resolveScope(
      { categoryCode: 1020, regionName: "Vũng Tàu", wardName: "Phường 99", regionV2: 13023, areaM2: 45, bedrooms: 3 },
      index(),
    );
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.tier, 2);
      assert.equal(r.scope.scope_level, "province");
      assert.equal(r.scope.area_name, null);
      assert.ok(r.scope.scope_key.startsWith("province:"));
    }
  });

  await check("không có ward lẫn tỉnh -> not_enough_data", () => {
    const r = resolveScope(
      { categoryCode: 1020, regionName: null, wardName: null, regionV2: null, areaM2: 45, bedrooms: 3 },
      index(),
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.reason.includes("khu vực"));
  });

  await check("mô tả scope có tên người đọc được, không phải mã", () => {
    const r = resolveScope(
      { categoryCode: 1010, regionName: "TP HCM", wardName: "Phường 13", regionV2: 13000, areaM2: 50, bedrooms: 2 },
      index(),
    );
    assert.ok(r.ok);
    if (r.ok) {
      assert.ok(!/13101/.test(r.scope.scope_description), "không lộ mã địa phương cho UI");
      assert.ok(r.scope.scope_description.includes("Căn hộ"));
    }
  });

  console.log("\n== Khoảng cách địa lý ==");

  await check("trùng toạ độ -> 0 km", () => {
    assert.equal(haversineKm(10.75, 106.62, 10.75, 106.62), 0);
  });

  await check("cặp toạ độ đã biết -> khoảng cách hợp lý", () => {
    // (10.8231,106.6297) -> (10.7769,106.7009): ~5.1km theo chiều dọc + ~7.8km ngang
    const km = haversineKm(10.8231, 106.6297, 10.7769, 106.7009)!;
    assert.ok(km > 8 && km < 11, `km=${km}`);
  });

  await check("thiếu tọa độ -> null (KHÔNG gán 0, KHÔNG đoán)", () => {
    assert.equal(haversineKm(null, 106.62, 10.77, 106.7), null);
    assert.equal(haversineKm(10.77, null, 10.77, 106.7), null);
    assert.equal(haversineKm(0, 0, 10.77, 106.7), null, "(0,0) = dữ liệu thiếu");
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  // process.exit() huy async handle -> libuv assertion tren Windows.
  // process.exitCode de tien trinh tu thoat, chay lai 100%
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
