// Bulk Prioritized Call Queue (PHASE 5) — xếp thứ tự ưu tiên gọi.
//
// Trọng tâm bảo vệ:
// - Xếp hạng THUẦN: không mạng, không DB, không React, không sửa đầu vào.
// - "Chưa phân tích" KHÁC "tin kém": dòng chưa có điểm vào CẦN THỬ LẠI.
// - Không tạo điểm ưu tiên mới; chỉ dùng investment_score + tie-break đã định.
// - Câu chữ không biến thứ tự gọi thành lời hứa về kết quả/danh tính/pháp lý.
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import {
  bandForScore,
  buildCallQueue,
  compareQueueRows,
  countByBand,
  criticalRiskFlags,
  isRankable,
  type QueueInputRow,
} from "../lib/call-queue/queue.ts";
import {
  BAND_LABEL,
  BAND_NOTE,
  BAND_SCALE_NOTE,
  FORBIDDEN_QUEUE_CLAIMS,
  LEGAL_RISK_ASK,
  LEGAL_RISK_WARNING,
  QUEUE_SCOPE_NOTE,
  RETRY_NOTE,
  buildAskPrompt,
  buildQueueSummary,
  buildReasons,
  hasLegalRisk,
  queueScoreBadgeClass,
  retryStatusLabel,
} from "../lib/call-queue/wording.ts";

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

const QUEUE_SRC = "lib/call-queue/queue.ts";
const WORDING_SRC = "lib/call-queue/wording.ts";
const CLIENT_SRC = "components/dashboard/bulk-check.tsx";

/** Dòng đã chấm xong, mọi field tuỳ chọn mặc định "chưa biết". */
function row(patch: Partial<QueueInputRow> & { inputIndex: number; score: number | null }): QueueInputRow {
  return {
    text: `Tin số ${patch.inputIndex}`,
    dealType: null,
    isNgop: null,
    status: "completed",
    ...patch,
  };
}

/** Mọi chuỗi mà hàng đợi sinh ra cho người dùng đọc. */
function queueStrings(rows: readonly QueueInputRow[]): string[] {
  const q = buildCallQueue(rows);
  return [
    ...Object.values(BAND_LABEL),
    ...Object.values(BAND_NOTE),
    BAND_SCALE_NOTE,
    QUEUE_SCOPE_NOTE,
    RETRY_NOTE,
    buildQueueSummary(q.stats.completed, q.stats.retry, q.stats.total),
    ...q.ranked.flatMap((it) => [...it.reasons, it.askPrompt]),
    ...q.retry.map((r) => retryStatusLabel(r)),
  ];
}

function assertNoForbidden(strings: string[], where: string) {
  for (const text of strings) {
    for (const claim of FORBIDDEN_QUEUE_CLAIMS) {
      assert.equal(
        text.toLowerCase().includes(claim.toLowerCase()),
        false,
        `${where}: không được chứa "${claim}" — gặp trong: ${text}`,
      );
    }
  }
}

// ------------------------------------------------------------------ A-E ranking

console.log("\n== A. điểm cao xếp trước ==");

check("A score 90 xếp trước score 70", () => {
  const q = buildCallQueue([row({ inputIndex: 0, score: 70 }), row({ inputIndex: 1, score: 90 })]);
  assert.equal(q.ranked.length, 2);
  assert.equal(q.ranked[0].score, 90);
  assert.equal(q.ranked[0].inputIndex, 1);
  assert.equal(q.ranked[0].rank, 1);
  assert.equal(q.ranked[1].rank, 2);
});

console.log("\n== B. cùng điểm: cờ rủi ro pháp lý xuống dưới ==");

check("B cùng điểm, rui_ro_phap_ly xếp sau", () => {
  const q = buildCallQueue([
    row({ inputIndex: 0, score: 85, dealType: "rui_ro_phap_ly" }),
    row({ inputIndex: 1, score: 85, dealType: "ngop_ngon" }),
  ]);
  assert.equal(q.ranked[0].inputIndex, 1, "tin không có cờ pháp lý phải đứng trước");
  assert.equal(q.ranked[1].inputIndex, 0);
});

check("B2 criticalRiskFlags chỉ 1 với rui_ro_phap_ly", () => {
  assert.equal(criticalRiskFlags(row({ inputIndex: 0, score: 80, dealType: "rui_ro_phap_ly" })), 1);
  assert.equal(criticalRiskFlags(row({ inputIndex: 1, score: 80, dealType: "ngop_ngon" })), 0);
  assert.equal(criticalRiskFlags(row({ inputIndex: 2, score: 80, dealType: null })), 0);
});

console.log("\n== C-D. is_ngop là tie-break, null xếp sau ==");

check("C cùng điểm/risk: is_ngop cao hơn xếp trước", () => {
  const q = buildCallQueue([
    row({ inputIndex: 0, score: 80, isNgop: 40 }),
    row({ inputIndex: 1, score: 80, isNgop: 90 }),
  ]);
  assert.equal(q.ranked[0].isNgop, 90);
  assert.equal(q.ranked[1].isNgop, 40);
});

check("D is_ngop null xếp SAU giá trị đã biết (không quy về 0)", () => {
  const q = buildCallQueue([
    row({ inputIndex: 0, score: 80, isNgop: null }),
    row({ inputIndex: 1, score: 80, isNgop: 10 }),
  ]);
  assert.equal(q.ranked[0].isNgop, 10, "giá trị đã biết đứng trước null");
  assert.equal(q.ranked[1].isNgop, null);
});

check("D2 cả hai null -> rơi xuống tie-break inputIndex", () => {
  const q = buildCallQueue([
    row({ inputIndex: 5, score: 80, isNgop: null }),
    row({ inputIndex: 2, score: 80, isNgop: null }),
  ]);
  assert.equal(q.ranked[0].inputIndex, 2);
});

console.log("\n== E-F. thứ tự ổn định ==");

check("E mọi thứ bằng nhau -> inputIndex ASC", () => {
  const q = buildCallQueue([
    row({ inputIndex: 9, score: 60 }),
    row({ inputIndex: 3, score: 60 }),
    row({ inputIndex: 7, score: 60 }),
  ]);
  assert.deepEqual(q.ranked.map((r) => r.inputIndex), [3, 7, 9]);
});

check("F cùng input hai lần -> deepEqual", () => {
  const rows = [
    row({ inputIndex: 0, score: 90, isNgop: 70, dealType: "ngop_ngon" }),
    row({ inputIndex: 1, score: 55, dealType: "rui_ro_phap_ly" }),
    row({ inputIndex: 2, score: null, status: "stopped" }),
  ];
  assert.deepEqual(buildCallQueue(rows), buildCallQueue(rows));
});

check("compareQueueRows tự nhất quán (a vs a = 0)", () => {
  const r = row({ inputIndex: 0, score: 80, isNgop: 50 });
  assert.equal(compareQueueRows(r, r), 0);
});

// ------------------------------------------------------ G-I eligibility

console.log("\n== G-I. điều kiện vào xếp hạng ==");

check("G score null -> KHÔNG vào ranked, vào retry", () => {
  const q = buildCallQueue([row({ inputIndex: 0, score: null, status: "completed" })]);
  assert.equal(q.ranked.length, 0);
  assert.equal(q.retry.length, 1);
});

check("H có error -> KHÔNG vào ranked, vào retry", () => {
  const q = buildCallQueue([row({ inputIndex: 0, score: 90, error: "Lỗi 500" })]);
  assert.equal(q.ranked.length, 0);
  assert.equal(q.retry.length, 1);
});

check("I stopped/pending/running -> retry, không phải 'tin kém'", () => {
  const q = buildCallQueue([
    row({ inputIndex: 0, score: null, status: "stopped" }),
    row({ inputIndex: 1, score: null, status: "pending" }),
    row({ inputIndex: 2, score: null, status: "running" }),
  ]);
  assert.equal(q.ranked.length, 0, "không dòng nào được xếp hạng");
  assert.equal(q.retry.length, 3);
  // Quan trọng: chưa phân tích KHÔNG bị xếp vào nhóm thấp.
  assert.equal(q.ranked.some((r) => r.band === "later"), false);
});

check("I2 isRankable từ chối score không hữu hạn", () => {
  assert.equal(isRankable(row({ inputIndex: 0, score: Number.NaN })), false);
  assert.equal(isRankable(row({ inputIndex: 1, score: Number.POSITIVE_INFINITY })), false);
  assert.equal(isRankable(row({ inputIndex: 2, score: 0 })), true, "0 là điểm THẬT, vẫn xếp hạng");
});

// ------------------------------------------------------------- J bands

console.log("\n== J. nhóm ưu tiên theo ngưỡng tuyệt đối ==");

check("J 80 => call_first, 79 => consider, 50 => consider, 49 => later", () => {
  assert.equal(bandForScore(80), "call_first");
  assert.equal(bandForScore(79), "consider");
  assert.equal(bandForScore(50), "consider");
  assert.equal(bandForScore(49), "later");
  assert.equal(bandForScore(100), "call_first");
  assert.equal(bandForScore(0), "later");
});

check("J2 tất cả dưới 50 -> KHÔNG có nhóm GỌI TRƯỚC nào", () => {
  const q = buildCallQueue([
    row({ inputIndex: 0, score: 49 }),
    row({ inputIndex: 1, score: 20 }),
  ]);
  const counts = countByBand(q.ranked);
  assert.equal(counts.call_first, 0);
  assert.equal(counts.later, 2);
  // Thứ hạng vẫn là tương đối trong lô.
  assert.equal(q.ranked[0].rank, 1);
  assert.equal(q.ranked[1].rank, 2);
});

// ------------------------------------------------------------- K cached

console.log("\n== K. cached xếp hạng bình thường ==");

check("K cached vẫn xếp theo điểm, chỉ đánh dấu", () => {
  const q = buildCallQueue([
    row({ inputIndex: 0, score: 70, cached: true }),
    row({ inputIndex: 1, score: 90, cached: false }),
  ]);
  assert.equal(q.ranked[0].score, 90);
  assert.equal(q.ranked[0].cached, false);
  assert.equal(q.ranked[1].cached, true, "cờ cached được giữ để hiển thị");
});

// ------------------------------------------------------------- L 100 rows

console.log("\n== L. 100 dòng ==");

check("L 100 dòng -> 100 item có thứ tự ổn định", () => {
  const rows: QueueInputRow[] = Array.from({ length: 100 }, (_, i) =>
    row({ inputIndex: i, score: (i * 7) % 101, isNgop: i % 3 === 0 ? null : (i * 13) % 101 }),
  );
  const q = buildCallQueue(rows);
  assert.equal(q.ranked.length, 100);
  assert.equal(q.stats.total, 100);
  assert.equal(q.stats.completed, 100);
  assert.equal(q.stats.retry, 0);
  // rank liên tục 1..100
  q.ranked.forEach((it, i) => assert.equal(it.rank, i + 1));
  // không giảm dần theo điểm
  for (let i = 1; i < q.ranked.length; i++) {
    assert.ok(q.ranked[i - 1].score >= q.ranked[i].score, `vị trí ${i} bị lệch thứ tự điểm`);
  }
  // tất định
  assert.deepEqual(buildCallQueue(rows), q);
});

// ------------------------------------------------------------- M no mutation

console.log("\n== M. không sửa đầu vào ==");

check("M buildCallQueue không đổi mảng/đối tượng đầu vào", () => {
  const rows = [
    row({ inputIndex: 0, score: 30 }),
    row({ inputIndex: 1, score: 90 }),
    row({ inputIndex: 2, score: null, status: "error", error: "Lỗi" }),
  ];
  const snapshot = JSON.parse(JSON.stringify(rows));
  const orderBefore = rows.map((r) => r.inputIndex);

  buildCallQueue(rows);

  assert.deepEqual(JSON.parse(JSON.stringify(rows)), snapshot, "đầu vào phải nguyên vẹn");
  assert.deepEqual(rows.map((r) => r.inputIndex), orderBefore, "thứ tự mảng gốc không được đổi");
});

check("M2 mảng trả về là bản sao, sửa nó không ảnh hưởng đầu vào", () => {
  const rows = [row({ inputIndex: 0, score: 80 })];
  const q = buildCallQueue(rows);
  q.ranked.push({ ...q.ranked[0], rank: 99 });
  assert.equal(rows.length, 1);
  assert.equal(buildCallQueue(rows).ranked.length, 1);
});

check("M3 mảng rỗng -> kết quả rỗng, không lỗi", () => {
  const q = buildCallQueue([]);
  assert.deepEqual(q.ranked, []);
  assert.deepEqual(q.retry, []);
  assert.deepEqual(q.stats, { completed: 0, retry: 0, total: 0 });
});

// ------------------------------------------------------------- N-O wording

console.log("\n== N. guard câu chữ ==");

check("N mọi chuỗi hàng đợi sạch claim bị cấm", () => {
  const rows = [
    row({ inputIndex: 0, score: 95, isNgop: 90, dealType: "ngop_ngon", legalSafety: 85 }),
    row({ inputIndex: 1, score: 85, dealType: "rui_ro_phap_ly", legalSafety: 20 }),
    row({ inputIndex: 2, score: 60, dealType: "gia_cao" }),
    row({ inputIndex: 3, score: 40 }),
    row({ inputIndex: 4, score: null, status: "stopped" }),
    row({ inputIndex: 5, score: null, status: "error", error: "Lỗi mạng" }),
  ];
  assertNoForbidden(queueStrings(rows), "queue");
});

check("N2 nhãn nhóm đúng hợp đồng", () => {
  assert.equal(BAND_LABEL.call_first, "GỌI TRƯỚC");
  assert.equal(BAND_LABEL.consider, "CÂN NHẮC");
  assert.equal(BAND_LABEL.later, "ĐỂ SAU");
});

check("N3 câu chữ nói rõ không phải khuyến nghị đầu tư", () => {
  assert.match(QUEUE_SCOPE_NOTE, /không phải khuyến nghị đầu tư/i);
  assert.match(QUEUE_SCOPE_NOTE, /lô tin bạn vừa chấm/i);
});

check("N4 retry note nói rõ chưa phân tích không phải tin kém", () => {
  assert.match(RETRY_NOTE, /chưa phân tích không có nghĩa là tin kém/i);
});

console.log("\n== O. câu chữ tín hiệu ngộp ==");

check("O urgency nói 'cần xác minh sớm', không nói kèo ngon", () => {
  const r = buildReasons(row({ inputIndex: 0, score: 88, isNgop: 75 }));
  const joined = r.join(" ");
  assert.match(joined, /cần xác minh sớm/i);
  assert.equal(joined.toLowerCase().includes("kèo ngon"), false);
  assert.equal(joined.toLowerCase().includes("kèo hời"), false);
  assert.equal(joined.toLowerCase().includes("deal"), false);
});

check("O2 isNgop thấp -> không hề nhắc tín hiệu", () => {
  const r = buildReasons(row({ inputIndex: 0, score: 55, isNgop: 10 }));
  assert.equal(r.join(" ").toLowerCase().includes("xác minh sớm"), false);
});

check("O3 legalSafety cao -> không nói 'pháp lý sạch'", () => {
  const r = buildReasons(row({ inputIndex: 0, score: 88, legalSafety: 95 }));
  const joined = r.join(" ").toLowerCase();
  assert.equal(joined.includes("pháp lý sạch"), false);
  assert.equal(joined.includes("an toàn"), false);
  assert.match(joined, /ít dấu hiệu rủi ro pháp lý hơn/i);
});

check("O4 rui_ro_phap_ly -> reason nói rõ xếp dưới, không khẳng định xấu", () => {
  const r = buildReasons(row({ inputIndex: 0, score: 88, dealType: "rui_ro_phap_ly" }));
  assert.match(r.join(" "), /rủi ro pháp lý/i);
  assert.equal(r.join(" ").toLowerCase().includes("đã xác minh"), false);
});

check("O5 reason luôn có ít nhất một câu", () => {
  for (const r of [
    row({ inputIndex: 0, score: 50 }),
    row({ inputIndex: 1, score: 90, isNgop: 80, legalSafety: 90, dealType: "ngop_ngon" }),
    row({ inputIndex: 2, score: 30, dealType: "gia_cao" }),
  ]) {
    assert.ok(buildReasons(r).length >= 1, `score ${r.score} thiếu reason`);
  }
});

console.log("\n== ask prompt ==");

check("ask prompt theo phân loại, có mặc định", () => {
  assert.match(buildAskPrompt(row({ inputIndex: 0, score: 80, dealType: "rui_ro_phap_ly" })), /pháp lý/i);
  assert.match(buildAskPrompt(row({ inputIndex: 1, score: 80, dealType: "gia_cao" })), /giá chào/i);
  assert.match(buildAskPrompt(row({ inputIndex: 2, score: 80 })), /sổ đứng tên ai/i);
});

check("ask prompt sạch claim bị cấm", () => {
  for (const dt of ["rui_ro_phap_ly", "gia_cao", null, "ngop_ngon"]) {
    assertNoForbidden([buildAskPrompt(row({ inputIndex: 0, score: 80, dealType: dt }))], `ask(${dt})`);
  }
});

console.log("\n== summary / retry labels ==");

check("summary đúng định dạng đếm", () => {
  assert.equal(buildQueueSummary(17, 3, 20), "17/20 tin đã phân tích · 3 tin cần thử lại");
});

check("retryStatusLabel phân biệt được các trạng thái chưa xong", () => {
  assert.match(retryStatusLabel(row({ inputIndex: 0, score: null, status: "stopped" })), /hết lượt/i);
  assert.match(retryStatusLabel(row({ inputIndex: 1, score: null, status: "pending" })), /chưa chạy/i);
  assert.match(retryStatusLabel(row({ inputIndex: 2, score: null, status: "running" })), /đang chạy/i);
  assert.match(retryStatusLabel(row({ inputIndex: 3, score: null, status: "error", error: "Lỗi mạng" })), /Lỗi mạng/);
  assertNoForbidden(
    ["stopped", "pending", "running", "error"].map((s, i) =>
      retryStatusLabel(row({ inputIndex: i, score: null, status: s as QueueInputRow["status"] })),
    ),
    "retry labels",
  );
});

console.log("\n== phân bổ nhóm ==");

check("countByBand đếm đúng và luôn đủ 3 khoá", () => {
  const q = buildCallQueue([
    row({ inputIndex: 0, score: 90 }),
    row({ inputIndex: 1, score: 85 }),
    row({ inputIndex: 2, score: 60 }),
    row({ inputIndex: 3, score: 10 }),
  ]);
  const counts = countByBand(q.ranked);
  assert.deepEqual(counts, { call_first: 2, consider: 1, later: 1 });
});

check("countByBand với danh sách rỗng -> toàn 0", () => {
  assert.deepEqual(countByBand([]), { call_first: 0, consider: 0, later: 0 });
});

console.log("\n== item mang đủ field cho UI ==");

check("item có checkId/seoSlug/sourceUrl để dựng CTA", () => {
  const q = buildCallQueue([
    row({
      inputIndex: 0,
      score: 88,
      checkId: "11111111-2222-3333-4444-555555555555",
      seoSlug: "ban-gap-nha-da-nang-5-5-ty-abc123",
      sourceUrl: "https://www.chotot.com/tin-abc",
      province: "Đà Nẵng",
    }),
  ]);
  const it = q.ranked[0];
  assert.equal(it.checkId, "11111111-2222-3333-4444-555555555555");
  assert.equal(it.seoSlug, "ban-gap-nha-da-nang-5-5-ty-abc123");
  assert.equal(it.sourceUrl, "https://www.chotot.com/tin-abc");
  assert.equal(it.province, "Đà Nẵng");
});

check("dòng dán văn bản -> sourceUrl null (không render CTA tin gốc)", () => {
  const q = buildCallQueue([row({ inputIndex: 0, score: 80 })]);
  assert.equal(q.ranked[0].sourceUrl, null);
});

// ------------------------------------------------------------- static guards

console.log("\n== ADDENDUM: legal-risk vẫn theo điểm, nhưng phải hiện cảnh báo ==");

check("ADD-1 score 90 + rui_ro_phap_ly VẪN xếp trên score 80 thường", () => {
  // Điểm là tiêu chí CHÍNH. Cờ pháp lý chỉ là tie-break #2, không được đẩy
  // tin rủi ro pháp lý xuống dưới tin điểm thấp hơn.
  const q = buildCallQueue([
    row({ inputIndex: 0, score: 80, dealType: "ngop_ngon" }),
    row({ inputIndex: 1, score: 90, dealType: "rui_ro_phap_ly" }),
  ]);
  assert.equal(q.ranked[0].score, 90, "điểm 90 phải đứng trên điểm 80");
  assert.equal(q.ranked[0].dealType, "rui_ro_phap_ly");
  assert.equal(q.ranked[0].rank, 1);
  assert.equal(q.ranked[1].score, 80);
});

check("ADD-2 tin rủi ro pháp lý nhận cảnh báo rõ ràng", () => {
  const q = buildCallQueue([row({ inputIndex: 0, score: 90, dealType: "rui_ro_phap_ly" })]);
  const it = q.ranked[0];
  assert.equal(hasLegalRisk(it.dealType), true);
  assert.match(it.reasons.join(" "), /rủi ro pháp lý/i);
  assert.equal(it.reasons.some((r) => r.includes(LEGAL_RISK_WARNING)), true, "phải có đúng câu cảnh báo");
});

check("ADD-3 tin rủi ro pháp lý KHÔNG bị mô tả bằng khẳng định tích cực", () => {
  const q = buildCallQueue([
    row({ inputIndex: 0, score: 95, dealType: "rui_ro_phap_ly", legalSafety: 90, isNgop: 90 }),
  ]);
  const it = q.ranked[0];
  const joined = [...it.reasons, it.askPrompt].join(" ").toLowerCase();
  for (const bad of ["kèo ngon", "pháp lý sạch", "an toàn", "đã xác minh", "chắc chắn"]) {
    assert.equal(joined.includes(bad), false, `không được dùng "${bad}" cho tin rủi ro pháp lý`);
  }
  // Không được nói "ít rủi ro pháp lý" chỉ vì legalSafety cao, khi phân loại là rủi ro.
  assert.equal(joined.includes("ít dấu hiệu rủi ro pháp lý hơn"), false);
});

check("ADD-4 Cần hỏi ngay của tin rủi ro pháp lý đúng câu bắt buộc", () => {
  const q = buildCallQueue([row({ inputIndex: 0, score: 90, dealType: "rui_ro_phap_ly" })]);
  assert.equal(q.ranked[0].askPrompt, LEGAL_RISK_ASK);
  assert.equal(
    q.ranked[0].askPrompt,
    "Hỏi kỹ pháp lý: sổ đứng tên ai, quy hoạch, thế chấp.",
  );
});

check("ADD-5 badge điểm của tin rủi ro pháp lý không dùng màu 'tốt'", () => {
  // Quy ước repo: rủi ro pháp lý không được nhìn như trạng thái tốt dù điểm cao.
  const legalHigh = queueScoreBadgeClass(95, "rui_ro_phap_ly");
  const normalHigh = queueScoreBadgeClass(95, "ngop_ngon");
  assert.notEqual(legalHigh, normalHigh, "tin rủi ro pháp lý phải khác tin thường ở cùng điểm");
  assert.match(legalHigh, /risk-high/, "phải dùng token rủi ro cao");
  assert.equal(legalHigh.includes("ai-ink"), false, "không dùng màu 'tốt' cho rủi ro pháp lý");
  // Tin thường điểm cao vẫn dùng màu tốt như cũ.
  assert.match(normalHigh, /ai-ink/);
});

check("ADD-6 badge vẫn theo ngưỡng điểm cho tin không có cờ pháp lý", () => {
  assert.match(queueScoreBadgeClass(85, null), /ai-ink/);
  assert.match(queueScoreBadgeClass(60, "binh_thuong"), /risk-medium/);
  assert.match(queueScoreBadgeClass(30, null), /risk-high/);
});

check("ADD-7 tie cùng điểm: tin thường xếp trước tin rủi ro pháp lý", () => {
  // criticalRiskFlags ASC là tie-break #2 — giữ nguyên như đã duyệt.
  const q = buildCallQueue([
    row({ inputIndex: 0, score: 85, dealType: "rui_ro_phap_ly" }),
    row({ inputIndex: 1, score: 85, dealType: "binh_thuong" }),
  ]);
  assert.equal(q.ranked[0].dealType, "binh_thuong");
  assert.equal(q.ranked[1].dealType, "rui_ro_phap_ly");
});

check("ADD-8 mọi chuỗi mới vẫn sạch claim bị cấm", () => {
  assertNoForbidden(
    [
      LEGAL_RISK_WARNING,
      LEGAL_RISK_ASK,
      ...buildReasons(row({ inputIndex: 0, score: 95, dealType: "rui_ro_phap_ly" })),
      buildAskPrompt(row({ inputIndex: 1, score: 95, dealType: "rui_ro_phap_ly" })),
    ],
    "addendum legal-risk copy",
  );
});

check("ADD-9 component hiện cảnh báo pháp lý trên card", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  assert.ok(src.includes("hasLegalRisk("), "card phải kiểm tra cờ pháp lý");
  assert.ok(src.includes("LEGAL_RISK_WARNING"), "card phải render cảnh báo");
  assert.ok(src.includes("queueScoreBadgeClass("), "điểm phải dùng badge theo quy ước pháp lý");
});

console.log("\n== static: module thuần ==");

check("lib/call-queue không có mạng/DB/await", () => {
  for (const f of [QUEUE_SRC, WORDING_SRC]) {
    const raw = readFileSync(f, "utf8");
    // Bỏ dòng comment: comment mô tả ràng buộc ("không gọi /api/check") là hợp lệ,
    // chỉ code thật mới bị cấm.
    const code = raw
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
      .join("\n");
    for (const bad of ["fetch(", "/api/", "supabase", "createClient", "adminClient", "await ", "XMLHttpRequest"]) {
      assert.equal(code.includes(bad), false, `${f} không được chứa "${bad}" trong code`);
    }
  }
});

check("lib/call-queue không import React/Next", () => {
  for (const f of [QUEUE_SRC, WORDING_SRC]) {
    const src = readFileSync(f, "utf8");
    for (const bad of ['from "react"', "from 'react'", "next/", "useState", "useEffect"]) {
      assert.equal(src.includes(bad), false, `${f} không được kéo UI vào module thuần`);
    }
  }
});

check("component dùng buildCallQueue", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  assert.ok(src.includes("buildCallQueue"), "bulk-check phải dùng hàng đợi");
  assert.ok(src.includes("@/lib/call-queue/queue"), "phải import từ module thuần");
});

check("component chỉ có đúng 1 POST /api/check (đường bulk cũ)", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  // Đếm theo METHOD để phân biệt GET quota với POST chấm điểm.
  const posts = [...src.matchAll(/fetch\("\/api\/check",\s*\{/g)].length;
  assert.equal(posts, 1, `chỉ được có 1 POST /api/check, thấy ${posts}`);
  // Hàng đợi không được thêm lời gọi /api/check nào khác.
  const all = [...src.matchAll(/fetch\("\/api\/check"/g)].length;
  assert.equal(all, 2, `tổng fetch /api/check phải là 2 (1 GET quota + 1 POST), thấy ${all}`);
});

check("component dùng reportUrl hiện có, không tự dựng URL báo cáo", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  assert.ok(src.includes('from "@/lib/report/slug"'), "phải dùng helper sẵn có");
  assert.ok(src.includes("reportUrl("), "phải gọi helper");
  // Không tự ghép chuỗi đường dẫn báo cáo.
  assert.equal(src.includes('"/bao-cao/"'), false, "không hardcode đường dẫn báo cáo");
  assert.equal(/`\/bao-cao\//.test(src), false, "không tự ghép đường dẫn báo cáo");
});

check("CTA tin gốc dùng target blank + rel an toàn", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  assert.ok(src.includes('target="_blank"'));
  assert.ok(src.includes('rel="noopener noreferrer"'));
});

check("không nhét URL vào analytics", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  for (const m of src.matchAll(/trackEvent\([^)]*\)/g)) {
    const call = m[0];
    for (const bad of ["sourceUrl", "seoSlug", "checkId"]) {
      assert.equal(call.includes(bad), false, `event không được chứa ${bad}: ${call}`);
    }
  }
});

check("CTA đạt tap target >= 48px", () => {
  const src = readFileSync(CLIENT_SRC, "utf8");
  // CTA trong hàng đợi dùng h-12 (48px) hoặc h-[48px]+
  const queueCtas = [...src.matchAll(/className="[^"]*h-12[^"]*"/g)].length;
  assert.ok(queueCtas >= 2, "phải có CTA cao 48px trong hàng đợi");
  for (const m of src.matchAll(/h-\[(\d+)px\]/g)) {
    assert.ok(Number(m[1]) >= 48, `nút ${m[1]}px phải >= 48px`);
  }
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
