// Regression: user đang có PRO/TEAM hiệu lực KHÔNG được render payment section mua mới trên /pricing.
// Expired entitlement phải rơi về free -> payment section lại hiện.
import { strict as assert } from "node:assert";
import { effectivePlan } from "../lib/quota.ts";
import { isProPlan, isPaymentConfirmed } from "../lib/payments.ts";

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

function showPaymentSection(plan: string | null | undefined, expiresAt: string | null | undefined): boolean {
  // Mirror logic trong app/pricing/page.tsx
  const effective = effectivePlan(plan, expiresAt);
  return !isProPlan(effective);
}

console.log("\n== pricing payment visibility ==");

check("Active PRO => payment section hidden", () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.equal(showPaymentSection("pro", future), false);
});

check("Active TEAM => payment section hidden", () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.equal(showPaymentSection("team", future), false);
});

check("Free => payment section visible", () => {
  assert.equal(showPaymentSection("free", null), true);
  assert.equal(showPaymentSection(null, null), true);
});

check("Expired PRO => không nhận nhầm là active, payment section visible", () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  assert.equal(isProPlan(effectivePlan("pro", past)), false);
  assert.equal(showPaymentSection("pro", past), true);
});

check("Expired TEAM => không nhận nhầm là active", () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  assert.equal(isProPlan(effectivePlan("team", past)), false);
  assert.equal(showPaymentSection("team", past), true);
});

check("payment confirmation contract không đổi", () => {
  assert.equal(isPaymentConfirmed({ status: "paid" }), true);
  assert.equal(isPaymentConfirmed({ status: "pending" }), false);
  assert.equal(isPaymentConfirmed({ status: "failed" }), false);
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
