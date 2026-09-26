// Self-check: trích SĐT người đăng từ text tin. Chạy: npm test
import { strict as assert } from "node:assert";
import { extractPhone, normalizePhone, formatPhone } from "../lib/phone.ts";

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
  console.log("\n== Trích SĐT từ text tin ==");

  await check("SĐT liền khối 10 số", () => {
    assert.equal(extractPhone("Liên hệ anh Thắng 0909123456 để xem nhà"), "0909123456");
  });

  await check("SĐT có dấu chấm/gạch/khoảng trắng", () => {
    assert.equal(extractPhone("Gọi 0909.123.456"), "0909123456");
    assert.equal(extractPhone("Gọi 0909-123-456"), "0909123456");
    assert.equal(extractPhone("Gọi 0909 123 456"), "0909123456");
    assert.equal(extractPhone("Gọi 090 912 3456"), "0909123456");
  });

  await check("đầu số 03/05/07/08 đều nhận", () => {
    assert.equal(extractPhone("SĐT 0328123456"), "0328123456");
    assert.equal(extractPhone("SĐT 0528123456"), "0528123456");
    assert.equal(extractPhone("SĐT 0728123456"), "0728123456");
    assert.equal(extractPhone("SĐT 0828123456"), "0828123456");
    assert.equal(extractPhone("SĐT 0898123456"), "0898123456");
  });

  await check("định dạng +84 và 84", () => {
    assert.equal(extractPhone("Liên hệ +84909123456"), "0909123456");
    assert.equal(extractPhone("Liên hệ 84909123456"), "0909123456");
  });

  await check("không nhầm giá/diện tích thành SĐT", () => {
    assert.equal(extractPhone("Nhà 80m2 giá 5.5 tỷ, 3 phòng ngủ, sổ hồng riêng"), null);
    assert.equal(extractPhone("Diện tích 2020m2 giá 46 tỷ"), null);
  });

  await check("SĐT đã che (089899****) không nhận", () => {
    assert.equal(extractPhone("SĐT 089899**** để xem nhà"), null);
  });

  await check("đầu số lạ (01/02/04/06) bị loại", () => {
    assert.equal(normalizePhone("0123456789"), null);
    assert.equal(normalizePhone("0223456789"), null);
    assert.equal(normalizePhone("090912345"), null);
  });

  await check("lấy SĐT đầu tiên trong text nhiều số", () => {
    assert.equal(
      extractPhone("Chủ nhà 0912345678, cò 0987654321"),
      "0912345678",
    );
  });

  await check("định dạng hiển thị 0909 123 456", () => {
    assert.equal(formatPhone("0909123456"), "0909 123 456");
    assert.equal(formatPhone(null), "");
    assert.equal(formatPhone("0898123456"), "0898 123 456");
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
