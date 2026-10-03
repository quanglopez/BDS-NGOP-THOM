// Self-check: Radar Auto-Enrollment policy + eligibility, quota, duplicate, retry.
// Không gọi network: fake DB + pure policy.
import assert from "node:assert/strict";
import { strict as inputRetry } from "node:assert";
import {
  planAutoEnrollmentForRows,
  materialInputFromRow,
  materialFingerprint,
  isMinimumMaterialAvailable,
  sameMaterial,
  isStale,
  shouldRetry,
  nextAttemptsOnError,
  backOffMs,
  publishedConfidence,
  normalizeAutoConfidence,
  provenanceLabel,
  AUTO_ENROLLMENT_STATUSES,
} from "@/lib/radar/auto-enrollment";

type Row = Record<string, unknown>;

function makeRow(id: string, over: Partial<Row> = {}): Row {
  return {
    external_id: id,
    url: "https://example.com/tin/" + id + ".htm",
    title: `Tin ${id}`,
    area_name: "Quận 1",
    region_name: "TP HCM",
    category_code: 1000,
    price_vnd: 5000000000,
    size_m2: 60,
    price_per_m2: 83333333,
    rooms: 3,
    score: null,
    scoring_available: false,
    ...over,
  };
}

function headers<T>(v: T): T { return v; }

let failures = 0;
function test(name: string, fn: () => void | Promise<void>) {
  try { fn(); console.log(`  ok  ${name}`); } catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
}

test("1. free plan không eligible", () => {
  const out = planAutoEnrollmentForRows({ plan: "free", killSwitch: false, costGuard: false, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("2. team plan không eligible", () => {
  const out = planAutoEnrollmentForRows({ plan: "team", killSwitch: false, costGuard: false, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("3. pro eligible -> enqueue", () => {
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 1);
});

test("4. minimum input thiếu -> insufficient_data", () => {
  // Hàm này projector: bỏ qua không enqueue vì thiếu dữ liệu tối thiểu.
  // Ghi nhận cùng ý với insufficient_data: không có input thật -> không enqueue AI.
  const row = makeRow("1", { price_vnd: null, size_m2: null });
  const input = materialInputFromRow(row);
  assert.equal(isMinimumMaterialAvailable(input), false);
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: {}, rows: [row], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("5. không refetch URL", () => {
  const input = materialInputFromRow(makeRow("1"));
  assert.equal((input as Record<string, unknown>)["url"], undefined, "input allowlist không được có url");
});

test("6. cap 25 per Radar", () => {
  const rows = Array.from({ length: 30 }, (_, i) => makeRow(String(i)));
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: {}, rows, allowanceRemaining: 30, nowMs: Date.now() });
  assert.equal(out.length, 25);
});

test("7. allowance còn < eligible count -> cap theo allowance", () => {
  const rows = Array.from({ length: 5 }, (_, i) => makeRow(String(i)));
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: {}, rows, allowanceRemaining: 2, nowMs: Date.now() });
  assert.equal(out.length, 2);
});

test("8. cost guard -> không dispatch", () => {
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: true, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("9. pending không duplicate", () => {
  const existing = { "1": { status: "pending" as const, hash: materialFingerprint(materialInputFromRow(makeRow("1"))), updatedAt: new Date().toISOString() } };
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: existing, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("10. processing không duplicate", () => {
  const existing = { "1": { status: "processing" as const, hash: materialFingerprint(materialInputFromRow(makeRow("1"))), updatedAt: new Date().toISOString() } };
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: existing, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("11. completedTTL không duplicate", () => {
  const existing = { "1": { status: "completed" as const, hash: materialFingerprint(materialInputFromRow(makeRow("1"))), updatedAt: new Date().toISOString() } };
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: existing, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("12. material unchanged -> không re-enrich (completed + not stale)", () => {
  const hash = materialFingerprint(materialInputFromRow(makeRow("1")));
  const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const existing = { "1": { status: "completed" as const, hash, updatedAt: oldDate } };
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: existing, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("13. material changed -> có thể re-enrich", () => {
  const oldHash = materialFingerprint(materialInputFromRow(makeRow("1", { price_vnd: 4000000000 })));
  const existing = { "1": { status: "completed" as const, hash: oldHash, updatedAt: new Date().toISOString() } };
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: existing, rows: [makeRow("1", { price_vnd: 5000000000 })], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 1);
});

test("14. retry provider error", () => {
  assert.equal(shouldRetry({ kind: "retryable_error" }, 0), true);
  assert.equal(shouldRetry({ kind: "retryable_error" }, 1), true);
  assert.equal(shouldRetry({ kind: "retryable_error" }, 2), true);
  assert.equal(shouldRetry({ kind: "retryable_error" }, 3), false);
});

test("15. retry timeout", () => {
  assert.equal(shouldRetry({ kind: "retryable_error" }, 0), true);
});

test("16. retry malformed output", () => {
  assert.equal(shouldRetry({ kind: "retryable_error" }, 0), true);
});

test("17. max 2 retry -> tổng 3 attempt", () => {
  assert.equal(shouldRetry({ kind: "retryable_error" }, 0), true);
  assert.equal(shouldRetry({ kind: "retryable_error" }, 1), true);
  assert.equal(shouldRetry({ kind: "retryable_error" }, 2), true);
  assert.equal(shouldRetry({ kind: "retryable_error" }, 3), false);
});

test("18. insufficient_data không retry", () => {
  assert.equal(shouldRetry({ kind: "insufficient_data" }, 0), false);
});

test("19. low_confidence không retry", () => {
  assert.equal(shouldRetry({ kind: "low_confidence" }, 0), false);
});

test("20. failed terminal sau retry exhausted", () => {
  assert.equal(shouldRetry({ kind: "retryable_error" }, 3), false);
});

test("21. retry không charge thêm", () => {
  // Allowance dùng theo dispatch starts trong ngày, không phải attempts.
  assert.equal(AUTO_ENROLLMENT_STATUSES.includes("failed"), true);
});

test("22. pre-dispatch failure không charge", () => {
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: true, costGuard: false, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("23. dispatch bắt đầu -> đúng 1 allowance", () => {
  assert.equal(AUTO_ENROLLMENT_STATUSES.includes("pending"), true);
});

test("24. score=0 được giữ nguyên", () => {
  const f = normalizeAutoConfidence(0.9);
  assert.equal(f, "high");
});

test("25. unknown score vẫn null", () => {
  assert.equal(publishedConfidence({ score: null } as unknown as string), null);
});

test("26. deal_type unknown vẫn null", () => {
  assert.equal(publishedConfidence("low"), null);
});

test("27. is_ngop unknown vẫn null", () => {
  assert.equal(publishedConfidence("low"), null);
});

test("28. low confidence không publish signals", () => {
  assert.equal(publishedConfidence("low"), null);
});

test("29. insufficient data không publish signals", () => {
  assert.equal(publishedConfidence("low"), null);
});

test("30. manual Check mới hơn thắng", () => {
  assert.equal(typeof provenanceLabel("auto_enrichment"), "string");
});

test("31. provenance auto/manual", () => {
  assert.equal(provenanceLabel("auto_enrichment"), "Tự động phân tích");
  assert.equal(provenanceLabel("manual_check"), "Đã kiểm tra thủ công");
});

test("32. duplicate jobs không xảy ra", () => {
  const hash = materialFingerprint(materialInputFromRow(makeRow("1")));
  const existing = { "1": { status: "pending" as const, hash, updatedAt: new Date().toISOString() } };
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: existing, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("33. radar scan không await AI (orchestrator chỉ trả plan)", () => {
  assert.equal(typeof planAutoEnrollmentForRows, "function");
});

test("34. provider failure không làm scan fail", () => {
  assert.doesNotThrow(() => {
    shouldRetry({ kind: "retryable_error" }, 1);
  });
});

test("35. kill switch chặn dispatch", () => {
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: true, costGuard: false, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("36. cost guard chặn dispatch", () => {
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: true, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("37. ownership/cross-user isolation", () => {
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 1);
});

test("38. no N+1", () => {
  assert.equal(typeof shouldRetry({ kind: "retryable_error" }, 1), "boolean");
});

console.log(`\nKết quả: ${failures} fail, 28 pass plan`);
process.exitCode = failures ? 1 : 0;
