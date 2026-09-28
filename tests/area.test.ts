// Self-check: trích diện tích + địa lý đi tới Price Intelligence. Chạy: npm test
// Dùng assert thuần, không thêm test framework.

import { strict as assert } from "node:assert";
import { extractAreaM2, parseAreaHint, resolveAreaM2 } from "../lib/area.ts";
import { resolveListingGeo } from "../lib/geo/url-parser.ts";
import { hasCheckGeo } from "../lib/check-geo.ts";

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

async function main() {
  console.log("\n== extractAreaM2 (dải diện tích là bẫy) ==");

  // Ca đã lộ trên production: regex cũ /(\d+)\s*m2/ ra 5 -> area_m2=5 ->
  // price_per_m2 sai ~13 lần, size band 3-8 m2, crawl 0 mẫu.
  await check("dải diện tích -> null, KHÔNG phải 5", () => {
    assert.equal(extractAreaM2("Diện tích từ: 62-82,5-105,5m2"), null);
  });

  await check("dải không có phần thập phân -> null", () => {
    assert.equal(extractAreaM2("Diện tích từ: 62-105m2"), null);
  });

  await check("một diện tích bình thường -> lấy đúng", () => {
    assert.equal(extractAreaM2("Diện tích: 66 m2"), 66);
  });

  await check("diện tích thập phân dấu phẩy -> giữ nguyên", () => {
    assert.equal(extractAreaM2("Diện tích 105,5m2"), 105.5);
  });

  await check("dùng m² (mũ hai) -> lấy đúng", () => {
    assert.equal(extractAreaM2("Diện tích: 66 m²"), 66);
  });

  await check("không có số nào trước m2 -> null", () => {
    assert.equal(extractAreaM2("Bán nhà mặt tiền 5 tỷ"), null);
  });

  await check("số vô lý (0 / quá lớn) -> null", () => {
    assert.equal(extractAreaM2("Diện tích: 0 m2"), null);
    assert.equal(extractAreaM2("Diện tích: 999999 m2"), null);
  });

  console.log("\n== parseAreaHint (số có cấu trúc từ /api/extract) ==");

  await check('area_hint "66 m²" -> 66', () => {
    assert.equal(parseAreaHint("66 m²"), 66);
  });

  await check('area_hint "66 m2" -> 66', () => {
    assert.equal(parseAreaHint("66 m2"), 66);
  });

  await check("area_hint là số -> giữ nguyên", () => {
    assert.equal(parseAreaHint(66), 66);
  });

  await check("area_hint rác/rỗng -> null, không bịa", () => {
    assert.equal(parseAreaHint(""), null);
    assert.equal(parseAreaHint(null), null);
    assert.equal(parseAreaHint(undefined), null);
    assert.equal(parseAreaHint({}), null);
  });

  console.log("\n== resolveAreaM2 (ưu tiên số có cấu trúc) ==");

  await check("có area_hint -> dùng hint, KHÔNG đụng text", () => {
    const r = resolveAreaM2("Diện tích từ: 62-82,5-105,5m2", "66 m²");
    assert.equal(r.areaM2, 66);
    assert.equal(r.source, "hint");
  });

  await check("thiếu area_hint -> mới quét text", () => {
    const r = resolveAreaM2("Diện tích: 66 m2", null);
    assert.equal(r.areaM2, 66);
    assert.equal(r.source, "text");
  });

  await check("không có ở đâu -> none, không đoán", () => {
    const r = resolveAreaM2("Bán nhà 5 tỷ", null);
    assert.equal(r.areaM2, null);
    assert.equal(r.source, "none");
  });

  await check("hint rác -> vẫn thử được text (không mất diện tích)", () => {
    const r = resolveAreaM2("Diện tích: 80 m2", "abc");
    assert.equal(r.areaM2, 80);
    assert.equal(r.source, "text");
  });

  console.log("\n== Geo đi tới Price Intelligence ==");

  // Tin production 114028645: gateway trả ward/area/region có cấu trúc.
  await check("ward + region từ extract -> resolveListingGeo trả về đủ", () => {
    const geo = resolveListingGeo({
      scanWard: "Phường An Hải Bắc",
      scanRegion: "Đà Nẵng",
    });
    assert.equal(geo.ward_name, "Phường An Hải Bắc");
    assert.equal(geo.region_name, "Đà Nẵng");
    assert.equal(geo.ward_source, "scan");
    assert.equal(geo.region_source, "scan");
  });

  await check("geo đủ -> hasCheckGeo true (sẽ ghi DB, không skip)", () => {
    const geo = resolveListingGeo({ scanWard: "Phường An Hải Bắc", scanRegion: "Đà Nẵng" });
    assert.equal(hasCheckGeo(geo), true);
  });

  await check("client KHÔNG gửi ward/region -> geo rỗng, hasCheckGeo false", () => {
    const geo = resolveListingGeo({ scanWard: null, scanRegion: null });
    assert.equal(hasCheckGeo(geo), false);
  });

  await check("chỉ có ward thì region null, không bịa tỉnh", () => {
    const geo = resolveListingGeo({ scanWard: "Phường An Hải Bắc", scanRegion: null });
    assert.equal(geo.ward_name, "Phường An Hải Bắc");
    assert.equal(geo.region_name, null);
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

void main();
