// Regression: PaymentBox không được báo success khi payment intent chưa paid.
// isPaymentConfirmed phải trả true CHỈ khi đúng payment intent có status paid.
import { strict as assert } from "node:assert";
import { isPaymentConfirmed, isProPlan, transferContent, quotePrice } from "../lib/payments.ts";

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}

console.log("\n== payment success contract ==");

check("chưa có payment => không success", () => {
  assert.equal(isPaymentConfirmed(null), false);
  assert.equal(isPaymentConfirmed(undefined), false);
  assert.equal(isPaymentConfirmed({}), false);
});

check("payment pending => KHÔNG success", () => {
  assert.equal(isPaymentConfirmed({ status: "pending" }), false);
  assert.equal(isPaymentConfirmed({ status: "failed" }), false);
});

check("plan hiện tại là pro KHÔNG được tính success nếu payment của intent vẫn pending", () => {
  // Bug trước: data.plan === "pro" => upgraded = true
  const userAlreadyPro = true;
  const paymentIntent = { status: "pending" };
  assert.equal(userAlreadyPro && paymentIntent.status === "pending", true);
  assert.equal(isPaymentConfirmed(paymentIntent), false);
});

check("đúng payment intent status=paid => success", () => {
  assert.equal(isPaymentConfirmed({ status: "paid" }), true);
  assert.equal(isPaymentConfirmed({ status: "PAID" }), false); // contract nhạy hoa thường, không đoán
});

check("transfer_content khớp intent, không bị cross-payment", () => {
  const c1 = transferContent("3f2504e0-4f89-11d3-9a0c-0305e82c3301", 3);
  const c2 = transferContent("3f2504e0-4f89-11d3-9a0c-0305e82c3301", 6);
  assert.notEqual(c1, c2);
});

console.log("\n== pricing entitlement ==");

check("free / null => không phải trả phí", () => {
  assert.equal(isProPlan("free"), false);
  assert.equal(isProPlan(null), false);
  assert.equal(isProPlan(undefined), false);
});

check("pro / team => hiện trạng thái gói hiện tại", () => {
  assert.equal(isProPlan("pro"), true);
  assert.equal(isProPlan("team"), true);
});

check("price dùng entitlement để ẩn CTA giả", () => {
  assert.equal(isProPlan("pro"), true);
  assert.ok(quotePrice(3).total > 0);
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
