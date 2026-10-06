// ReportViewModel — chốt ngữ nghĩa "chưa biết" và bảo vệ chống dữ liệu giả.
//
// Đây là hàng rào cho ACCEPTANCE CRITERIA của đợt chuyển sang backend contract:
// mỗi case dưới đây là 1 cách dữ liệu giả có thể lọt vào report nếu ai đó
// viết lại `?? 0` / `|| "binh_thuong"`. Test fail = đã có dữ liệu giả quay lại.
//
// Nguyên tắc chung: 0 là kết luận thật, null là chưa biết. Hai cái này KHÁC
// nhau và adapter phải giữ được ranh giới đó ở mọi field.

import { strict as assert } from "node:assert";
import {
  buildEntitlement,
} from "../lib/report/entitlement.ts";
import { formatAiGeneratedAt } from "../lib/format.ts";
import {
  buildEvidenceBoard,
  buildImageBoard,
  buildPriceDifference,
  buildPriceIntelligenceView,
  buildReportViewModel,
  normalizeConfidence,
  normalizeConfidenceLevel,
  normalizeDealType,
  normalizeFreshness,
  normalizeIsNgop,
  normalizeReportStatus,
  normalizeScore,
  DEAL_TYPE_UNKNOWN_DISPLAY,
  IS_NGOP_UNKNOWN_DISPLAY,
  SCORE_UNKNOWN_DISPLAY,
} from "../lib/report/view-model.ts";
import { MIN_SAMPLE_SIZE, type PriceIntelligence } from "../lib/price/types.ts";
import { normalizeAutoConfidence } from "../lib/radar/auto-enrollment.ts";

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

// ---------------------------------------------------------------- AC 1 + 2
// 1. deal_type null  -> "CHƯA CÓ NHẬN ĐỊNH"
// 2. deal_type binh_thuong -> "BÌNH THƯỜNG"

console.log("\n== AC1/AC2: deal_type ==");

check("AC1. null -> CHƯA CÓ NHẬN ĐỊNH, known=false", () => {
  const d = normalizeDealType(null);
  assert.equal(d.display, "CHƯA CÓ NHẬN ĐỊNH");
  assert.equal(d.display, DEAL_TYPE_UNKNOWN_DISPLAY);
  assert.equal(d.known, false);
  assert.equal(d.value, null);
});

check("AC1. undefined / chuỗi rỗng cũng là chưa có nhận định", () => {
  assert.equal(normalizeDealType(undefined).known, false);
  assert.equal(normalizeDealType("").known, false);
  assert.equal(normalizeDealType("   ").known, false);
  assert.equal(normalizeDealType("   ").display, "CHƯA CÓ NHẬN ĐỊNH");
});

check("AC1. giá trị LẠ của provider KHÔNG rơi về bình thường", () => {
  // Đây là bẫt cũ: `DEAL_LABELS[deal] ?? "BÌNH THƯỜNG"` biến nhãn lạ thành
  // "bình thường" — tức tin chưa ai phân loại lại hiện ra như tin đã đánh giá.
  const d = normalizeDealType("loai_la_khong_biet");
  assert.equal(d.known, false, "nhãn lạ phải là chưa biết, không phải bình thường");
  assert.equal(d.value, null);
  assert.equal(d.display, "CHƯA CÓ NHẬN ĐỊNH");
  assert.notEqual(d.display, "BÌNH THƯỜNG");
});

check("AC2. binh_thuong -> BÌNH THƯỜNG, known=true", () => {
  const d = normalizeDealType("binh_thuong");
  assert.equal(d.display, "BÌNH THƯỜNG");
  assert.equal(d.known, true);
  assert.equal(d.value, "binh_thuong");
});

check("AC1. giá trị lạ: raw provider value KHÔNG bị mất ở adapter (audit)", () => {
  const d = normalizeDealType("moi_nhan_cua_model");
  assert.equal(d.value, null, "value phải null — UI không đọc nhãn lạ");
  assert.equal(d.display, "CHƯA CÓ NHẬN ĐỊNH");
  assert.equal(d.raw, "moi_nhan_cua_model", "nhãn thô phải còn để đối chiếu/audit");
});

check("AC1. known -> raw === value; thiếu chuỗi -> raw null", () => {
  assert.equal(normalizeDealType("binh_thuong").raw, "binh_thuong");
  assert.equal(normalizeDealType(null).raw, null);
  assert.equal(normalizeDealType(undefined).raw, null);
  assert.equal(normalizeDealType("").raw, null);
  assert.equal(normalizeDealType("   ").raw, null, "chuỗi toàn khoảng trắng là chưa biết, không phải raw");
});

check("AC2. mọi deal_type hợp lệ khác cũng có nhãn riêng", () => {
  assert.equal(normalizeDealType("ngop_ngon").display, "KÈO NGỘP NGON");
  assert.equal(normalizeDealType("thom_dau_tu").display, "TIỀM NĂNG CAO");
  assert.equal(normalizeDealType("gia_cao").display, "GIÁ CAO HƠN TT");
  assert.equal(normalizeDealType("rui_ro_phap_ly").display, "RỦI RO PHÁP LÝ");
});

// ---------------------------------------------------------------- AC 3 + 4
// 3. is_ngop null -> "Chưa xác định"
// 4. is_ngop 0    -> "Không"

console.log("\n== AC3/AC4: is_ngop ==");

check("AC3. null -> 'Chưa xác định', known=false", () => {
  const n = normalizeIsNgop(null);
  assert.equal(n.display, "Chưa xác định");
  assert.equal(n.display, IS_NGOP_UNKNOWN_DISPLAY);
  assert.equal(n.known, false);
  assert.equal(n.value, null);
});

check("AC4. 0 -> 'Không', known=true (0 là kết luận thật)", () => {
  const n = normalizeIsNgop(0);
  assert.equal(n.display, "Không");
  assert.equal(n.known, true, "0 phải là giá trị ĐÃ biết, không phải chưa biết");
  assert.equal(n.value, 0);
});

check("AC3/AC4. 0 và null là HAI trạng thái khác nhau", () => {
  const zero = normalizeIsNgop(0);
  const unknown = normalizeIsNgop(null);
  assert.notEqual(zero.display, unknown.display);
  assert.notEqual(zero.known, unknown.known);
  assert.notEqual(zero.value, unknown.value);
});

check("AC4. giá trị khác 0 vẫn giữ nguyên, không bị ép về 0", () => {
  const n = normalizeIsNgop(85);
  assert.equal(n.known, true);
  assert.equal(n.value, 85);
  assert.match(n.display, /85/);
});

check("AC3. undefined / NaN / ngoài thang -> chưa xác định", () => {
  for (const bad of [undefined, NaN, -1, 101, "80", {}]) {
    const n = normalizeIsNgop(bad);
    assert.equal(n.known, false, `giá trị ${String(bad)} phải là chưa biết`);
  }
});

// ---------------------------------------------------------------- AC 5 + 6
// 5. score null -> "Chưa chấm điểm"
// 6. score 0    -> "0/100"

console.log("\n== AC5/AC6: score ==");

check("AC5. null -> 'Chưa chấm điểm', known=false", () => {
  const s = normalizeScore(null);
  assert.equal(s.display, "Chưa chấm điểm");
  assert.equal(s.display, SCORE_UNKNOWN_DISPLAY);
  assert.equal(s.known, false);
  assert.equal(s.value, null);
});

check("AC6. 0 -> '0/100', known=true (điểm 0 là thật)", () => {
  const s = normalizeScore(0);
  assert.equal(s.display, "0/100");
  assert.equal(s.known, true, "điểm 0 phải là điểm đã chấm, không phải chưa chấm");
  assert.equal(s.value, 0);
});

check("AC6. '0/100' KHÔNG phải 'Chưa chấm điểm'", () => {
  assert.notEqual(normalizeScore(0).display, normalizeScore(null).display);
});

check("AC5. score hỏng / ngoài thang KHÔNG biến thành 0", () => {
  for (const bad of [undefined, NaN, -5, 147, "80"]) {
    const s = normalizeScore(bad);
    assert.equal(s.known, false, `score ${String(bad)} phải là chưa biết`);
    assert.equal(s.value, null, `score ${String(bad)} không được quy về 0`);
  }
});

check("AC6. score 100 vẫn hợp lệ", () => {
  assert.equal(normalizeScore(100).display, "100/100");
  assert.equal(normalizeScore(100).known, true);
});

// ------------------------------------------------------------- AC 7 + 8
// 7. difference_percent +12 -> "Cao hơn trung vị 12%"
// 8. difference_percent -12 -> "Thấp hơn trung vị 12%"

console.log("\n== AC7/AC8: chênh lệch giá ==");

check("AC7. +12 -> 'Cao hơn trung vị 12%', direction=above", () => {
  const d = buildPriceDifference(12);
  assert.ok(d);
  assert.equal(d.display, "Cao hơn trung vị 12%");
  assert.equal(d.direction, "above");
  assert.equal(d.percent, 12);
});

check("AC8. -12 -> 'Thấp hơn trung vị 12%', direction=below", () => {
  const d = buildPriceDifference(-12);
  assert.ok(d);
  assert.equal(d.display, "Thấp hơn trung vị 12%");
  assert.equal(d.direction, "below");
  assert.equal(d.percent, -12, "giữ nguyên dấu gốc của backend, không đảo");
});

check("AC7/AC8. adapter KHÔNG đảo dấu: dấu vào == dấu ra", () => {
  for (const raw of [12, -12, 0.5, -0.5, 100, -100]) {
    const d = buildPriceDifference(raw);
    assert.ok(d);
    assert.equal(d.percent, raw, `dấu của ${raw} bị đổi`);
    if (raw > 0) assert.equal(d.direction, "above");
    if (raw < 0) assert.equal(d.direction, "below");
  }
});

check("AC7/AC8. 0 -> 'Bằng trung vị' (không phải trống, không phải Cao/Thấp)", () => {
  const d = buildPriceDifference(0);
  assert.ok(d);
  assert.equal(d.display, "Bằng trung vị");
  assert.equal(d.direction, "equal");
});

check("AC7/AC8. null / NaN -> null (UI không hiện số chênh lệch)", () => {
  assert.equal(buildPriceDifference(null), null);
  assert.equal(buildPriceDifference(undefined), null);
  assert.equal(buildPriceDifference(NaN), null);
  assert.equal(buildPriceDifference("12"), null);
});

// ------------------------------------------------------------------- AC 9
// 9. sample không đủ -> KHÔNG hiện median/p25/p75 giả

console.log("\n== AC9: sample không đủ thì không có số thống kê giả ==");

function priceSnapshot(over: Partial<PriceIntelligence> = {}): PriceIntelligence {
  return {
    version: "price-v1",
    generated_at: "2026-10-01T00:00:00.000Z",
    source: "chotot_gateway",
    scope_level: "ward",
    scope: {
      scope_level: "ward",
      scope_key: "w1",
      scope_description: "Phường 1",
      region_name: "TP.HCM",
      area_name: null,
      category_code: 1000,
      category_name: "Căn hộ",
      size_min_m2: null,
      size_max_m2: null,
      rooms_min: null,
      rooms_max: null,
    },
    sample_size: 40,
    trimmed_size: 38,
    confidence: "high",
    quality_score: 90,
    excluded_promoted: 2,
    excluded_invalid: 1,
    statistics: {
      p25_ppm2: 40_000_000,
      median_ppm2: 50_000_000,
      p75_ppm2: 60_000_000,
      min_ppm2: 30_000_000,
      max_ppm2: 80_000_000,
    },
    comparables: [],
    target: { price_per_m2: 56_000_000, difference_percent: 12 },
    limitations: [],
    primary_scope_level: "ward",
    reference_scope_level: "ward",
    fallback_reason: null,
    ...over,
  } as PriceIntelligence;
}

check("AC9. đủ mẫu -> có median/p25/p75", () => {
  const v = buildPriceIntelligenceView({ state: "ready", data: priceSnapshot() });
  assert.equal(v.available, true);
  assert.equal(v.medianPpm2, 50_000_000);
  assert.equal(v.p25Ppm2, 40_000_000);
  assert.equal(v.p75Ppm2, 60_000_000);
});

check("AC9. dưới ngưỡng mẫu -> median/p25/p75/min/max ĐỀU null", () => {
  const v = buildPriceIntelligenceView({
    state: "ready",
    data: priceSnapshot({ sample_size: MIN_SAMPLE_SIZE - 1 }),
  });
  assert.equal(v.available, false);
  assert.equal(v.medianPpm2, null, "không được hiện median giả");
  assert.equal(v.p25Ppm2, null);
  assert.equal(v.p75Ppm2, null);
  assert.equal(v.minPpm2, null);
  assert.equal(v.maxPpm2, null);
});

check("AC9. statistics === null -> không có số nào", () => {
  const v = buildPriceIntelligenceView({ state: "ready", data: priceSnapshot({ statistics: null }) });
  assert.equal(v.available, false);
  assert.equal(v.medianPpm2, null);
});

check("AC9. not_enough_data -> mọi số null + có lời giải thích", () => {
  const v = buildPriceIntelligenceView({ state: "not_enough_data", data: null });
  assert.equal(v.available, false);
  assert.equal(v.medianPpm2, null);
  assert.equal(v.difference, null);
  assert.ok(v.message && v.message.length > 0, "phải nói lý do, không im lặng");
});

check("AC9. chênh lệch vẫn sống khi đủ mẫu, và giữ dấu", () => {
  const v = buildPriceIntelligenceView({ state: "ready", data: priceSnapshot() });
  assert.ok(v.difference);
  assert.equal(v.difference.display, "Cao hơn trung vị 12%");
});

// ------------------------------------------------------------------ AC 10
// 10. evidence chưa có nguồn -> không highlight text giả

console.log("\n== AC10: evidence ==");

check("AC10. không tín hiệu nào -> refs rỗng + unavailable", () => {
  const b = buildEvidenceBoard();
  assert.equal(b.available, false);
  assert.deepEqual(b.refs, []);
  assert.ok(b.reason, "phải nói vì sao chưa có");
});

check("AC10. tín hiệu source='missing' KHÔNG phải bằng chứng", () => {
  const b = buildEvidenceBoard({
    signals: [{ signal: "thiếu giá", detail: "Tin không ghi giá", source: "missing" }],
  });
  assert.equal(b.available, false, "'missing' mô tả sự thiếu, không phải bằng chứng");
  assert.deepEqual(b.refs, []);
});

check("AC10. tín hiệu thật -> có ref, không bịa id ngoài", () => {
  const b = buildEvidenceBoard({
    signals: [{ signal: "tranh chấp", detail: "Tin có đề cập tranh chấp", source: "listing_text" }],
  });
  assert.equal(b.available, true);
  assert.equal(b.refs.length, 1);
  assert.equal(b.refs[0].label, "tranh chấp");
  assert.equal(b.refs[0].type, "listing_text");
  assert.ok(b.refs[0].id.length > 0);
  assert.strictEqual(b.refs[0].location, null, "backend chưa lưu span thật -> location phải null, không bịa");
});

check("AC10. mọi ref đều có id + excerpt; location null khi chưa có span thật", () => {
  const b = buildEvidenceBoard({
    signals: [
      { signal: "hẻm nhỏ", detail: "Nội dung có hẻm nhỏ", source: "listing_text" },
      { signal: "Pháp lý yếu", detail: "Điểm pháp lý thấp", source: "calculated" },
    ],
  });
  for (const r of b.refs) {
    assert.ok(r.id, "ref phải có id");
    assert.ok(r.label.length > 0);
    assert.ok("excerpt" in r, "excerpt phải được set (null nếu chưa có)");
    assert.strictEqual(r.location, null, "chưa có span thật thì location null, không bịa chuỗi");
  }
  assert.equal(new Set(b.refs.map((r) => r.id)).size, b.refs.length, "id phải là duy nhất");
});

// ------------------------------------------------------------------ AC 11
// 11. image chưa có -> placeholder trung tính

console.log("\n== AC11: images ==");

check("AC11. không có ảnh nào -> state no_images, items rỗng", () => {
  const b = buildImageBoard([]);
  assert.equal(b.state, "no_images");
  assert.deepEqual(b.items, []);
});

check("AC11. undefined / null / không phải mảng -> no_images", () => {
  assert.equal(buildImageBoard(undefined).state, "no_images");
  assert.equal(buildImageBoard(null).state, "no_images");
  assert.equal(buildImageBoard({}).state, "no_images");
  assert.equal(buildImageBoard("abc").state, "no_images");
});

check("AC11. ảnh thiếu image_url -> loại, không tự sinh URL", () => {
  const b = buildImageBoard([{ thumbnail_url: "https://x/t.jpg" }]);
  assert.equal(b.state, "no_images", "không có image_url thì không phải ảnh dùng được");
  assert.deepEqual(b.items, []);
});

check("AC11. ảnh hợp lệ -> image_available, sort theo order", () => {
  const b = buildImageBoard([
    { image_url: "https://x/b.jpg", order: 2 },
    { image_url: "https://x/a.jpg", order: 1, source: "listing", rights: "granted" },
  ]);
  assert.equal(b.state, "image_available");
  assert.equal(b.items.length, 2);
  assert.equal(b.items[0].imageUrl, "https://x/a.jpg");
  assert.equal(b.items[0].rightsStatus, "granted");
  assert.equal(b.items[1].rightsStatus, "unknown", "không có rights -> unknown, không mặc định granted");
});

// ------------------------------------------- AC 12 + confidence + status
// 12. mọi raw field đi qua adapter

console.log("\n== AC12: mọi thứ đi qua adapter ==");

check("AC12. check đầy đủ -> view model đầy đủ", () => {
  const vm = buildReportViewModel({
    check: {
      id: "c1",
      score: 75,
      deal_type: "ngop_ngon",
      is_ngop: 40,
      confidence: 0.9,
      created_at: "2026-10-01T00:00:00.000Z",
    },
    plan: "pro",
  });
  assert.equal(vm.checkId, "c1");
  assert.equal(vm.score.display, "75/100");
  assert.equal(vm.dealType.display, "KÈO NGỘP NGON");
  assert.equal(vm.isNgop.known, true);
  assert.equal(vm.entitlement.canViewFullReport, true);
});

check("AC12. check rỗng -> KHÔNG nổ, không crash, mọi field unknown", () => {
  const vm = buildReportViewModel({});
  assert.equal(vm.checkId, null);
  assert.equal(vm.score.known, false);
  assert.equal(vm.dealType.known, false);
  assert.equal(vm.isNgop.known, false);
  assert.equal(vm.confidence.known, false);
  assert.equal(vm.proSummary, null);
  assert.equal(vm.evidence.available, false);
  assert.equal(vm.images.state, "no_images");
});

check("AC12. mọi field thiếu đều được liệt kê trong missingData", () => {
  const vm = buildReportViewModel({ check: { id: "c2", score: null, deal_type: null, is_ngop: null } });
  const fields = vm.missingData.map((m) => m.field);
  assert.ok(fields.includes("score"));
  assert.ok(fields.includes("deal_type"));
  assert.ok(fields.includes("is_ngop"));
  // Lý do evidence thiếu chỉ hiện 1 lần qua evidence.reason,
  // KHÔNG push trùng vào missingData (tránh UI liệt kê 2 lần).
  assert.ok(!fields.includes("evidence"));
  assert.ok(vm.evidence.reason && vm.evidence.reason.length > 0, "evidence.reason vẫn phải nói vì sao thiếu");
  for (const m of vm.missingData) {
    assert.ok(m.display.length > 0, "mỗi mục thiếu phải có câu hiển thị");
  }
});

check("AC12. check đủ thì missingData KHÔNG chứa score/deal_type/is_ngop", () => {
  const vm = buildReportViewModel({
    check: { id: "c3", score: 50, deal_type: "binh_thuong", is_ngop: 0 },
  });
  const fields = vm.missingData.map((m) => m.field);
  assert.ok(!fields.includes("score"));
  assert.ok(!fields.includes("deal_type"));
  assert.ok(!fields.includes("is_ngop"));
});

console.log("\n== confidence: số 0..1 -> low|medium|high, giữ cả raw ==");

check("numeric 0.9 -> high, raw giữ lại 0.9", () => {
  const c = normalizeConfidence({ numeric: 0.9 });
  assert.equal(c.value, "high");
  assert.equal(c.known, true);
  assert.equal(c.raw, 0.9, "không được mất số gốc — còn cần cho audit");
  assert.equal(c.display, "Cao");
});

check("ngưỡng: >=0.8 high, >=0.55 medium, còn lại low", () => {
  assert.equal(normalizeConfidenceLevel(0.8), "high");
  assert.equal(normalizeConfidenceLevel(0.79), "medium");
  assert.equal(normalizeConfidenceLevel(0.55), "medium");
  assert.equal(normalizeConfidenceLevel(0.54), "low");
  assert.equal(normalizeConfidenceLevel(0), "low");
});

check("threshold DUY NHẤT: view-model ủy quyền cho normalizeAutoConfidence (radar)", () => {
  // Nếu hai nơi lệch nhau, 1 tin sẽ đổi mức giữa report và thẻ Radar. Khóa:
  // mọi giá trị phải cho cùng kết quả ở cả hai hàm.
  for (const v of [0, 0.3, 0.54, 0.5499, 0.55, 0.56, 0.79, 0.7999, 0.8, 0.95, 1]) {
    assert.equal(normalizeConfidenceLevel(v), normalizeAutoConfidence(v), `mâu thuẫn tại ${v}`);
  }
  for (const bad of [-1, 2, NaN, "abc", null, undefined]) {
    assert.equal(normalizeConfidenceLevel(bad), normalizeAutoConfidence(bad), `mâu thuẫn tại rác ${String(bad)}`);
  }
});

check("level low|medium|high từ Pro/Price đi thẳng qua", () => {
  assert.equal(normalizeConfidence({ level: "high" }).value, "high");
  assert.equal(normalizeConfidence({ level: "medium" }).value, "medium");
  assert.equal(normalizeConfidence({ level: "low" }).value, "low");
  assert.equal(normalizeConfidence({ level: "low" }).display, "Thấp");
});

check("level ưu tiên numeric khi có cả hai", () => {
  const c = normalizeConfidence({ numeric: 0.95, level: "low" });
  assert.equal(c.value, "low", "level của module sinh ra nó được ưu tiên");
  assert.equal(c.raw, 0.95, "số gốc vẫn phải còn");
});

check("thiếu cả hai -> chưa đánh giá, KHÔNG mặc định 'medium'", () => {
  const c = normalizeConfidence({});
  assert.equal(c.known, false);
  assert.equal(c.value, null);
  assert.equal(c.raw, null);
});

check("confidence ngoài thang / rác -> chưa đánh giá", () => {
  assert.equal(normalizeConfidence({ numeric: 5 }).known, false, "5 nằm ngoài 0..1 -> chưa có");
  assert.equal(normalizeConfidence({ numeric: 5 }).raw, null, "số ngoài thang không phải raw hợp lệ");
  assert.equal(normalizeConfidence({ numeric: -1 }).known, false);
  assert.equal(normalizeConfidence({ numeric: "abc" }).known, false);
  assert.equal(normalizeConfidence({ level: "khong_hop_le" }).known, false);
});

console.log("\n== report status ==");

check("loading -> loading, analyzing -> analyzing", () => {
  assert.equal(normalizeReportStatus({ loading: true }), "loading");
  assert.equal(normalizeReportStatus({ analyzing: true }), "analyzing");
});

check("đầy đủ -> ready", () => {
  assert.equal(normalizeReportStatus({}), "ready");
  assert.equal(normalizeReportStatus({ incomplete: false }), "ready");
});

check("thiếu một phần -> partial (không phải failed)", () => {
  assert.equal(normalizeReportStatus({ incomplete: true }), "partial");
});

check("lỗi -> failed, không đọc được tin -> listing_unavailable", () => {
  assert.equal(normalizeReportStatus({ failed: true }), "failed");
  assert.equal(normalizeReportStatus({ listingUnavailable: true }), "listing_unavailable");
});

check("listing_unavailable thắng mọi trạng thái khác", () => {
  assert.equal(
    normalizeReportStatus({ listingUnavailable: true, failed: true, loading: true }),
    "listing_unavailable",
  );
});

check("failed thắng loading (đang tải mà đã biết là hỏng)", () => {
  assert.equal(normalizeReportStatus({ failed: true, loading: true }), "failed");
});

check("retry KHÔNG tự bật theo status failed", () => {
  assert.equal(buildReportViewModel({ failed: true }).retry.supported, false);
  assert.equal(
    buildReportViewModel({ failed: true, retrySupported: true }).retry.supported,
    true,
  );
});

check("trạng thái thiếu dữ liệu -> partial chứ không failed", () => {
  const vm = buildReportViewModel({ check: { id: "c4", score: null, deal_type: null } });
  assert.equal(vm.status, "partial", "thiếu dữ liệu vẫn đọc được report");
});

console.log("\n== freshness ==");

check("trong 2 ngày -> fresh, 2-14 ngày -> aging, >14 -> stale", () => {
  const now = Date.parse("2026-10-10T00:00:00.000Z");
  const day = 86_400_000;
  assert.equal(normalizeFreshness("2026-10-09T00:00:00.000Z", now), "fresh");
  assert.equal(normalizeFreshness("2026-10-01T00:00:00.000Z", now), "aging");
  assert.equal(normalizeFreshness("2026-09-01T00:00:00.000Z", now), "stale");
});

check("thiếu / sai định dạng -> unknown (KHÔNG coi là mới)", () => {
  assert.equal(normalizeFreshness(null), "unknown");
  assert.equal(normalizeFreshness("", 1000), "unknown");
  assert.equal(normalizeFreshness("khong-phai-ngay", 1000), "unknown");
});

console.log("\n== ai_generated_at: mốc AI thật, null = chưa biết ==");

check("ai_generated_at có -> vm.aiGeneratedAt giữ nguyên chuỗi", () => {
  const vm = buildReportViewModel({
    check: { id: "c5", score: 70, deal_type: "ngop_ngon", is_ngop: 60, ai_generated_at: "2026-10-05T09:30:00Z" },
  });
  assert.equal(vm.aiGeneratedAt, "2026-10-05T09:30:00Z");
});

check("ai_generated_at null/empty/rỗng -> null (KHÔNG tự tạo mốc)", () => {
  for (const bad of [null, undefined, "", "   "]) {
    const vm = buildReportViewModel({
      check: { id: "c6", score: 70, deal_type: "ngop_ngon", is_ngop: 60, ai_generated_at: bad as string | null },
    });
    assert.equal(vm.aiGeneratedAt, null, `input ${JSON.stringify(bad)} phải cho null`);
  }
});

check("ai_generated_at không có field -> null", () => {
  const vm = buildReportViewModel({ check: { id: "c7", score: 70, deal_type: "ngop_ngon", is_ngop: 60 } });
  assert.equal(vm.aiGeneratedAt, null);
});

check("ai_generated_at invalid not-a-date -> null, không throw, không tự tạo mốc", () => {
  const vm = buildReportViewModel({
    check: { id: "c8", score: 70, deal_type: "ngop_ngon", is_ngop: 60, ai_generated_at: "not-a-date" },
  });
  assert.equal(vm.aiGeneratedAt, null);
});

check("formatAiGeneratedAt: valid -> dd/mm/yyyy hh:mm; null/invalid -> null", () => {
  const out = formatAiGeneratedAt("2026-10-06T08:31:00Z");
  assert.ok(out, "valid phải render");
  assert.ok(out.includes("06/10/2026"), `thiếu ngày: ${out}`);
  assert.match(out, /\d{2}:\d{2}/, `thiếu giờ:phút: ${out}`);
  assert.equal(formatAiGeneratedAt(null), null);
  assert.equal(formatAiGeneratedAt("not-a-date"), null);
});

console.log("\n== entitlement ==");

check("gói trả phí -> mở hết", () => {
  for (const plan of ["pro", "team"]) {
    const e = buildEntitlement({ plan });
    assert.equal(e.canViewFullReport, true);
    assert.equal(e.canViewPriceIntelligence, true);
    assert.equal(e.canViewEvidenceDetail, true);
    assert.equal(e.canViewGallery, true);
    assert.equal(e.canViewRecommendationDetail, true);
  }
});

check("free / null / gói lạ -> khoá hết", () => {
  for (const plan of ["free", null, undefined, "khong_biet"]) {
    const e = buildEntitlement({ plan });
    assert.equal(e.canViewFullReport, false, `plan ${String(plan)} phải khoá`);
    assert.equal(e.canViewPriceIntelligence, false);
  }
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
