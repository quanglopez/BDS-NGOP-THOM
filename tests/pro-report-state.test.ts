// Regression: Pro Analysis loading state phải phân biệt loading/success/fallback/failed.
// Timeout phải đưa về failed + retrySupported, không được giữ skeleton vô hạn.
import { strict as assert } from "node:assert";
import { buildReportViewModel } from "../lib/report/view-model.ts";

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

console.log("\n== Pro Analysis state machine ==");

check("loading ban đầu", () => {
  const vm = buildReportViewModel({ loading: true, plan: "pro" });
  assert.equal(vm.status, "loading");
  assert.equal(vm.retry.supported, false);
});

check("API lỗi tạm thời -> failed + retry supported", () => {
  const vm = buildReportViewModel({ check: { id: "x" }, plan: "pro", failed: true, retrySupported: true });
  assert.equal(vm.status, "failed");
  assert.equal(vm.retry.supported, true);
});

check("API lỗi vĩnh viễn -> failed, không retry", () => {
  const vm = buildReportViewModel({ check: { id: "x" }, plan: "pro", failed: true, retrySupported: false });
  assert.equal(vm.status, "failed");
  assert.equal(vm.retry.supported, false);
});

check("fallback mà không có analysis -> failed", () => {
  const vm = buildReportViewModel({ check: { id: "x" }, plan: "pro", failed: true, retrySupported: true });
  assert.equal(vm.status, "failed");
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
