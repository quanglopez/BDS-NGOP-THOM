// Self-check: trích số phòng ngủ từ text tin. Chạy: npm test
import { strict as assert } from "node:assert";
import { extractBedrooms } from "../lib/bedrooms.ts";

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
  console.log("\n== extractBedrooms ==");

  await check("các cách viết phòng ngủ", () => {
    assert.equal(extractBedrooms("Nhà 3 phòng ngủ, 2 WC"), 3);
    assert.equal(extractBedrooms("nhà 4pn cho gia đình"), 4);
    assert.equal(extractBedrooms("căn hộ 2 ngủ"), 2);
    assert.equal(extractBedrooms("3ngủ"), 3);
  });

  await check("không nhầm số khác thành phòng ngủ", () => {
    assert.equal(extractBedrooms("Nhà 3 tầng, 80m2, 3 nhà vệ sinh"), null);
    assert.equal(extractBedrooms("Giá 5.5 tỷ, sổ hồng riêng"), null);
    assert.equal(extractBedrooms("115m2 mặt tiền Nguyễn Văn Khối"), null);
    assert.equal(extractBedrooms(""), null);
  });

  await check("số vô lý (0, 25) thì bỏ", () => {
    assert.equal(extractBedrooms("0 phòng ngủ"), null);
    assert.equal(extractBedrooms("25 phòng ngủ"), null);
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
