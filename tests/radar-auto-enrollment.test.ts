// Self-check: Radar Auto-Enrollment POLICY (thuần, không network, không DB).
// Runtime worker (claim/charge/retry/publish/manual race) ở tests/radar-enrichment-worker.test.ts;
// scan integration ở tests/radar-match.test.ts.
import assert from "node:assert/strict";
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
  isManualCheckWinnerOk,
  enrichmentStatusLabel,
  shouldShowProcessingPlaceholder,
  AUTO_ENROLLMENT_STATUSES,
  AUTO_ENRICHMENT_PER_RADAR_CAP,
  AUTO_ENRICHMENT_DAILY_LIMIT,
  AUTO_ENRICHMENT_TTL_MS,
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

const DAY = 24 * 60 * 60 * 1000;

let failures = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ok  ${name}`); } catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
}

// ---------------------------------------------------------------- eligibility

test("MANDATORY 20. free plan không enqueue", () => {
  const out = planAutoEnrollmentForRows({ plan: "free", killSwitch: false, costGuard: false, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("MANDATORY 21. team plan không enqueue", () => {
  const out = planAutoEnrollmentForRows({ plan: "team", killSwitch: false, costGuard: false, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("MANDATORY 19. pro eligible -> enqueue", () => {
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.row.external_id, "1");
  assert.ok(out[0]!.hash.length > 0);
});

test("input tối thiểu thiếu (giá/diện tích) -> không enqueue", () => {
  const input = materialInputFromRow(makeRow("1", { price_vnd: null, size_m2: null }));
  assert.equal(isMinimumMaterialAvailable(input), false);
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: {}, rows: [makeRow("1", { price_vnd: null, size_m2: null })], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("giá 0 / diện tích 0 không phải dữ liệu tối thiểu", () => {
  assert.equal(isMinimumMaterialAvailable({ price_vnd: 0, size_m2: 60 }), false);
  assert.equal(isMinimumMaterialAvailable({ price_vnd: 5000000000, size_m2: 0 }), false);
  assert.equal(isMinimumMaterialAvailable({ price_vnd: 5000000000, size_m2: 60 }), true);
});

test("không refetch URL: allowlist material không có url/original text", () => {
  const input = materialInputFromRow({ ...makeRow("1"), original_text: "nội dung riêng", phone: "0900000000" });
  assert.equal((input as Record<string, unknown>)["url"], undefined);
  assert.equal((input as Record<string, unknown>)["original_text"], undefined);
  assert.equal((input as Record<string, unknown>)["phone"], undefined);
});

// ---------------------------------------------------------------- caps

test("MANDATORY 15. cap 25 per Radar: 30 tin -> đúng 25", () => {
  const rows = Array.from({ length: 30 }, (_, i) => makeRow(String(i)));
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: {}, rows, allowanceRemaining: 300, nowMs: Date.now() });
  assert.equal(out.length, 25);
  assert.equal(out.length, AUTO_ENRICHMENT_PER_RADAR_CAP);
});

test("cap 25: 26 tin -> đúng 25, không phải 26", () => {
  const rows = Array.from({ length: 26 }, (_, i) => makeRow(String(i)));
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: {}, rows, allowanceRemaining: 300, nowMs: Date.now() });
  assert.equal(out.length, 25);
});

test("allowanceRemaining cap số enqueue", () => {
  const rows = Array.from({ length: 5 }, (_, i) => makeRow(String(i)));
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: {}, rows, allowanceRemaining: 2, nowMs: Date.now() });
  assert.equal(out.length, 2);
});

test("allowanceRemaining = 0 -> không enqueue", () => {
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 0, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("MANDATORY 18. cost guard -> không enqueue", () => {
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: true, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

test("MANDATORY 17. kill switch -> không enqueue", () => {
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: true, costGuard: false, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 0);
});

// ---------------------------------------------------------------- duplicates

test("MANDATORY 32. duplicate: pending/processing cùng fingerprint -> không enqueue lại", () => {
  const hash = materialFingerprint(materialInputFromRow(makeRow("1")));
  for (const status of ["pending", "processing"] as const) {
    const existing = { "1": { status, hash, updatedAt: new Date().toISOString() } };
    const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: existing, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
    assert.equal(out.length, 0, `${status} phải chặn duplicate`);
  }
});

test("MANDATORY 22. completed cùng fingerprint trong TTL -> không re-enrich", () => {
  const hash = materialFingerprint(materialInputFromRow(makeRow("1")));
  for (const days of [0, 1, 29]) {
    const existing = { "1": { status: "completed" as const, hash, updatedAt: new Date(Date.now() - days * DAY).toISOString() } };
    const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: existing, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
    assert.equal(out.length, 0, `completed ${days} ngày chưa được re-enrich`);
  }
});

test("MANDATORY 24. completed TTL 30 ngày: quá hạn -> được enqueue lại", () => {
  const hash = materialFingerprint(materialInputFromRow(makeRow("1")));
  assert.equal(isStale(new Date(Date.now() - 31 * DAY).toISOString()), true);
  const existing = { "1": { status: "completed" as const, hash, updatedAt: new Date(Date.now() - 31 * DAY).toISOString() } };
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: existing, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 1);
});

test("insufficient_data/low_confidence cùng fingerprint trong TTL -> không xét lại", () => {
  const hash = materialFingerprint(materialInputFromRow(makeRow("1")));
  for (const status of ["insufficient_data", "low_confidence"] as const) {
    const existing = { "1": { status, hash, updatedAt: new Date(Date.now() - 5 * DAY).toISOString() } };
    const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: existing, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
    assert.equal(out.length, 0, `${status} không retry khi material chưa đổi`);
  }
});

test("MANDATORY 23. material changed -> enqueue lại (kể cả terminal)", () => {
  const oldHash = materialFingerprint(materialInputFromRow(makeRow("1", { price_vnd: 4000000000 })));
  for (const status of ["completed", "insufficient_data", "low_confidence", "failed"] as const) {
    const existing = { "1": { status, hash: oldHash, updatedAt: new Date().toISOString() } };
    const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: existing, rows: [makeRow("1", { price_vnd: 5000000000 })], allowanceRemaining: 10, nowMs: Date.now() });
    assert.equal(out.length, 1, `${status} + material đổi phải cho enqueue lại`);
  }
});

test("terminal cũ KHÁC fingerprint không chặn fingerprint mới", () => {
  const currentHash = materialFingerprint(materialInputFromRow(makeRow("1")));
  const existing = { "1": { status: null, hash: null, updatedAt: null } };
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: existing, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.hash, currentHash);
});

// ---------------------------------------------------------------- retry policy

test("MANDATORY 7/8/9/10. retryable đúng 2 retry: attempts 1,2 retry / 3 dừng", () => {
  const decisions: boolean[] = [];
  let attempts = 1;
  while (attempts <= 3) {
    decisions.push(shouldRetry({ kind: "retryable_error" }, attempts));
    attempts = nextAttemptsOnError(attempts);
  }
  assert.deepEqual(decisions, [true, true, false], "tổng 3 lần gọi: 1 đầu + 2 retry");
  assert.equal(shouldRetry({ kind: "retryable_error" }, 0), true, "attempt 0 cũng retry (worker gọi sau dispatch)");
  assert.equal(shouldRetry({ kind: "retryable_error" }, 4), false);
});

test("không retry: insufficient_data / low_confidence / terminal_error", () => {
  for (const kind of ["insufficient_data", "low_confidence", "terminal_error"] as const) {
    assert.equal(shouldRetry({ kind }, 1), false, `${kind} không được retry`);
  }
});

test("backOffMs: dương, có trần, tăng theo attempt", () => {
  const b1 = backOffMs(1), b2 = backOffMs(2), b3 = backOffMs(3);
  for (const [n, b] of [[1, b1], [2, b2], [3, b3]] as const) {
    assert.ok(b > 0 && b <= 30_250, `backoff attempt ${n} phải trong (0, 30_250], got ${b}`);
  }
  assert.ok(b3 > b1, "backoff phải tăng theo attempt");
});

// ---------------------------------------------------------------- confidence / publish

test("publishedConfidence: chỉ medium/high", () => {
  assert.equal(publishedConfidence("high"), "high");
  assert.equal(publishedConfidence("medium"), "medium");
  assert.equal(publishedConfidence(0.8), "high");
  assert.equal(publishedConfidence(0.55), "medium");
  assert.equal(publishedConfidence("low"), null);
  assert.equal(publishedConfidence(0.54), null);
  assert.equal(publishedConfidence(undefined), null);
  assert.equal(publishedConfidence(NaN), null);
});

test("normalizeAutoConfidence: string không phân biệt hoa thường, số vô hạn -> null", () => {
  assert.equal(normalizeAutoConfidence("HIGH"), "high");
  assert.equal(normalizeAutoConfidence("Medium"), "medium");
  assert.equal(normalizeAutoConfidence("khong-biet"), null);
  assert.equal(normalizeAutoConfidence(Infinity), null);
  assert.equal(normalizeAutoConfidence(null), null);
});

// ---------------------------------------------------------------- fingerprint

test("fingerprint ổn định theo thứ tự key, đổi giá trị -> đổi hash", () => {
  const a = materialInputFromRow(makeRow("1"));
  const b = materialInputFromRow(makeRow("1"));
  assert.equal(materialFingerprint(a), materialFingerprint(b));
  const c = materialInputFromRow(makeRow("1", { price_vnd: 4_000_000_000 }));
  assert.notEqual(materialFingerprint(a), materialFingerprint(c));
  const reordered = { size_m2: a.size_m2, title: a.title, price_vnd: a.price_vnd, rooms: a.rooms } as Record<string, unknown>;
  assert.equal(materialFingerprint(reordered), materialFingerprint({ title: a.title, price_vnd: a.price_vnd, size_m2: a.size_m2, rooms: a.rooms }));
  assert.equal(sameMaterial(materialFingerprint(a), materialFingerprint(b)), true);
});

test("MANDATORY 27. null khác 0 trong fingerprint (không quy null về 0)", () => {
  const withNull = materialFingerprint({ price_vnd: null, size_m2: 60 });
  const withZero = materialFingerprint({ price_vnd: 0, size_m2: 60 });
  assert.notEqual(withNull, withZero, "null và 0 phải là hai vật liệu khác nhau");
});

// ---------------------------------------------------------------- wording / UI

test("MANDATORY 2/UI. pending TUYỆT ĐỐI không phải processing", () => {
  assert.equal(enrichmentStatusLabel("pending"), "Chờ phân tích");
  assert.equal(enrichmentStatusLabel("processing"), "Đang phân tích");
  assert.notEqual(enrichmentStatusLabel("pending"), enrichmentStatusLabel("processing"));
  assert.equal(enrichmentStatusLabel("completed"), "Đã chấm");
  assert.equal(enrichmentStatusLabel("insufficient_data"), "Không đủ dữ liệu");
  assert.equal(enrichmentStatusLabel("low_confidence"), "Độ tin cậy thấp");
  assert.equal(enrichmentStatusLabel("failed"), "Phân tích thất bại");
});

test("placeholder 'Đang phân tích' chỉ khi processing (đã dispatch)", () => {
  assert.equal(shouldShowProcessingPlaceholder({ scoringAvailable: false, status: "processing" }), true);
  assert.equal(shouldShowProcessingPlaceholder({ scoringAvailable: false, status: "pending" }), false);
  assert.equal(shouldShowProcessingPlaceholder({ scoringAvailable: true, status: "processing" }), false);
  assert.equal(shouldShowProcessingPlaceholder({ scoringAvailable: false, status: null }), false);
  assert.equal(shouldShowProcessingPlaceholder({ scoringAvailable: false, status: "completed" }), false);
});

test("provenance labels", () => {
  assert.equal(provenanceLabel("auto_enrichment"), "Tự động phân tích");
  assert.equal(provenanceLabel("manual_check"), "Đã kiểm tra thủ công");
  assert.equal(provenanceLabel("khac"), "");
});

// ---------------------------------------------------------------- constants

test("MANDATORY 14/15. policy constants chốt: 200 dispatch/ngày, 25/Radar, TTL 30 ngày", () => {
  assert.equal(AUTO_ENRICHMENT_DAILY_LIMIT, 200);
  assert.equal(AUTO_ENRICHMENT_PER_RADAR_CAP, 25);
  assert.equal(AUTO_ENRICHMENT_TTL_MS, 30 * 24 * 60 * 60 * 1000);
});

test("statuses liệt kê đúng tập trạng thái job", () => {
  assert.deepEqual([...AUTO_ENROLLMENT_STATUSES], [
    "not_started", "pending", "processing", "completed", "insufficient_data", "low_confidence", "failed",
  ]);
});

// ---------------------------------------------------------------- manual winner (pure)

test("MANDATORY 30. isManualCheckWinnerOk: Check mới hơn dispatch -> manual thắng", () => {
  const dispatch = "2026-10-03T00:00:00.000Z";
  assert.equal(isManualCheckWinnerOk("2026-10-03T00:05:00.000Z", dispatch), true, "manual mới hơn");
  assert.equal(isManualCheckWinnerOk("2026-10-02T23:55:00.000Z", dispatch), false, "manual cũ hơn");
  assert.equal(isManualCheckWinnerOk(dispatch, dispatch), false, "bằng nhau không phải mới hơn");
  assert.equal(isManualCheckWinnerOk(null, dispatch), false);
  assert.equal(isManualCheckWinnerOk("2026-10-03T00:05:00.000Z", null), false);
  assert.equal(isManualCheckWinnerOk("2026-10-03T00:05:00.000Z", "khong-parse-duoc"), false);
});

// ---------------------------------------------------------------- non-blocking

test("MANDATORY 34. planner KHÔNG await AI: trả Array đồng bộ, không Promise", () => {
  const out = planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: {}, rows: [makeRow("1")], allowanceRemaining: 10, nowMs: Date.now() });
  assert.ok(Array.isArray(out));
  assert.equal((out as unknown as { then?: unknown }).then, undefined, "planner không được trả Promise");
});

test("planner không mutate input rows", () => {
  const rows = [makeRow("1")];
  const before = JSON.stringify(rows);
  planAutoEnrollmentForRows({ plan: "pro", killSwitch: false, costGuard: false, existingStatus: {}, rows, allowanceRemaining: 10, nowMs: Date.now() });
  assert.equal(JSON.stringify(rows), before, "rows bị mutate");
});

console.log(`\nradar-auto-enrollment: ${failures} fail`);
process.exitCode = failures ? 1 : 0;
