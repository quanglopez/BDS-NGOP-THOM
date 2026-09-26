// Self-check: gói suy ra từ số tiền + nội dung CK. Chạy: npm test
import { strict as assert } from "node:assert";
import { planFromAmount, transferContent, PLANS } from "../lib/payments.ts";

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
  console.log("\n== planFromAmount ==");

  await check("đúng giá Pro (299k) -> pro", () => {
    assert.equal(planFromAmount(299000), "pro");
  });

  await check("trên giá Pro, dưới Team -> pro", () => {
    assert.equal(planFromAmount(350000), "pro");
  });

  await check("đúng giá Team (799k) -> team", () => {
    assert.equal(planFromAmount(799000), "team");
  });

  await check("dưới giá Pro -> null (webhook ghi unmatched, không nâng gói)", () => {
    assert.equal(planFromAmount(10000), null);
    assert.equal(planFromAmount(298999), null);
    assert.equal(planFromAmount(0), null);
    assert.equal(planFromAmount(-5), null);
  });

  await check("giá gói khớp hứa hẹn trên trang bảng giá", () => {
    assert.equal(PLANS.pro.price, 299000);
    assert.equal(PLANS.free.price, 0);
  });

  console.log("\n== transferContent ==");

  await check("nội dung CK đúng định dạng NANGCAP + uuid", () => {
    const uid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const c = transferContent(uid);
    assert.equal(c, `NANGCAP ${uid}`);
    // Webhook phải trích lại đúng uuid từ chính nội dung này
    const m = c.match(/NANGCAP\s+([0-9a-f-]{36})/i);
    assert.ok(m, "webhook phải match được");
    assert.equal(m![1], uid);
  });

  await check("regex webhook nhận cả nội dung thêm chữ phía sau", () => {
    const uid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const m = `NANGCAP ${uid} chuyen tien nang cap`.match(/NANGCAP\s+([0-9a-f-]{36})/i);
    assert.ok(m);
    assert.equal(m![1], uid);
  });

  await check("nội dung không có NANGCAP thì không match", () => {
    assert.equal("CK tien nha".match(/NANGCAP\s+([0-9a-f-]{36})/i), null);
    assert.equal("NANGCAP abc".match(/NANGCAP\s+([0-9a-f-]{36})/i), null);
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
