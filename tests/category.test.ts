// Self-check: quét danh mục Chợ Tốt/Nhà Tốt. Chạy: npm test
// Chỉ test thuần (phân tích slug, lọc tin, ghép payload) — không gọi mạng.

import { strict as assert } from "node:assert";
import { parseCategoryUrl, stripAdminPrefix } from "../lib/category-slug.ts";

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
  console.log("\n== Phân tích URL danh mục ==");

  await check("nhà đất Gò Vấp TP.HCM", () => {
    const r = parseCategoryUrl(
      "https://www.nhatot.com/mua-ban-nha-dat-quan-go-vap-tp-ho-chi-minh",
    );
    assert.ok(r, "phải parse được");
    assert.equal(r!.kind, "nha-dat");
    assert.equal(r!.wardSlug, "quan-go-vap");
    assert.equal(r!.provinceName, "TP.HCM");
  });

  await check("nhà ở có dấu, quận Hà Nội", () => {
    const r = parseCategoryUrl("https://www.nhatot.com/mua-ban-nha-o-quan-cau-giay-ha-noi");
    assert.ok(r, "phải parse được");
    assert.equal(r!.kind, "nha-o");
    assert.equal(r!.wardSlug, "quan-cau-giay");
    assert.equal(r!.provinceName, "Hà Nội");
  });

  await check("đất nền cấp tỉnh (không có quận)", () => {
    const r = parseCategoryUrl("https://www.chotot.com/mua-ban-dat-nen-da-nang");
    assert.ok(r, "phải parse được");
    assert.equal(r!.kind, "dat");
    assert.equal(r!.wardSlug, null);
    assert.equal(r!.provinceName, "Đà Nẵng");
  });

  await check("căn hộ Vũng Tàu", () => {
    const r = parseCategoryUrl("https://www.nhatot.com/mua-ban-can-ho-chung-cu-vung-tau");
    assert.ok(r, "phải parse được");
    assert.equal(r!.kind, "can-ho");
    assert.equal(r!.provinceName, "Vũng Tàu");
  });

  await check("URL tin chi tiết -> null (đi đường extract)", () => {
    assert.equal(
      parseCategoryUrl("https://www.nhatot.com/mua-ban-nha-dat/134384271.htm"),
      null,
    );
  });

  await check("host lạ -> null", () => {
    assert.equal(parseCategoryUrl("https://batdongsan.com.vn/nha-dat-ban"), null);
    assert.equal(parseCategoryUrl("not-a-url"), null);
  });

  await check("slug không rõ loại -> null", () => {
    assert.equal(parseCategoryUrl("https://www.nhatot.com/tin-tuc-bat-dong-san"), null);
  });

  console.log("\n== Tiện ích slug ==");

  await check("lột tiền tố hành chính", () => {
    assert.equal(stripAdminPrefix("quan-go-vap"), "go-vap");
    assert.equal(stripAdminPrefix("thanh-pho-vung-tau"), "vung-tau");
    assert.equal(stripAdminPrefix("thuy-van"), "thuy-van");
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
