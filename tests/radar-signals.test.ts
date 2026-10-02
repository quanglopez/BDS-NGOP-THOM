import assert from "node:assert/strict";
import { listingIdFromUrl, buildSignalIndex, passesSignalFilters, attachSignals, NGO_P_STRONG_THRESHOLD } from "@/lib/radar/signals";

// --- listingIdFromUrl: ID lấy từ URL Check (dạng SEO slug) ---
assert.equal(listingIdFromUrl("https://www.nhatot.com/tin/2018513141.htm"), "2018513141");
assert.equal(
  listingIdFromUrl("https://www.nhatot.com/cho-thue-nha-dat-duong-3-2-hai-chau-hai-phong-2--2037534871.htm"),
  "2037534871",
);
assert.equal(listingIdFromUrl("https://www.nhatot.com/tin/2018513141.htm?ref=abc"), "2018513141");
assert.equal(listingIdFromUrl("https://www.nhatot.com/tin/abc.htm"), null);
assert.equal(listingIdFromUrl("https://www.nhatot.com/tin/123"), null);
assert.equal(listingIdFromUrl(null), null);
assert.equal(listingIdFromUrl(undefined), null);
assert.equal(listingIdFromUrl(""), null);
assert.equal(listingIdFromUrl(12345), null);

// --- buildSignalIndex: Check mới nhất thắng, theo listing id ---
// is_ngop là sub-score Ngộp 0..100, không phải cờ 0/1.
const idx = buildSignalIndex([
  { listing_url: "https://nhatot.com/tin/111.htm", score: 40, deal_type: "gia_cao", is_ngop: 12, created_at: "2026-01-01T00:00:00Z" },
  { listing_url: "https://nhatot.com/tin/111.htm", score: 90, deal_type: "ngop_ngon", is_ngop: 85, created_at: "2026-02-01T00:00:00Z" },
  { listing_url: "https://nhatot.com/tin/111.htm", score: 10, deal_type: "binh_thuong", is_ngop: 8, created_at: "2025-12-01T00:00:00Z" },
]);
assert.equal(idx.get("111")?.score, 90);
assert.equal(idx.get("111")?.dealType, "ngop_ngon");
assert.equal(idx.get("111")?.isNgoP, 85);

// URL không có id thì bỏ qua, không ném lỗi
const mixed = buildSignalIndex([
  { listing_url: "https://nhatot.com/tin/222.htm", score: 70, deal_type: "thom_dau_tu", is_ngop: 15, created_at: "2026-01-01T00:00:00Z" },
  { listing_url: null, score: 99, deal_type: "gia_cao", is_ngop: 10, created_at: "2026-03-01T00:00:00Z" },
  { listing_url: "https://nhatot.com/khong-co-id.htm", score: 99, deal_type: "gia_cao", is_ngop: 10, created_at: "2026-03-01T00:00:00Z" },
]);
assert.equal(mixed.size, 1);
assert.equal(mixed.get("222")?.score, 70);

// --- passesSignalFilters: tin CHƯA chấm điểm luôn phải còn ---
const noFilters = { minScore: null, dealTypes: [], ngoPOnly: false };
assert.equal(passesSignalFilters(null, noFilters), true, "không có tín hiệu thì không được loại");
assert.equal(passesSignalFilters({ score: null, dealType: null, isNgoP: null }, noFilters), true);

const strong = { minScore: 80, dealTypes: ["ngop_ngon" as const] as unknown as string[], ngoPOnly: true };

// chưa chấm điểm -> vẫn hiện dù bộ lọc rất gắt
assert.equal(passesSignalFilters(null, strong), true, "tin chưa chấm điểm không bị bộ lọc giấu");
assert.equal(passesSignalFilters({ score: null, dealType: null, isNgoP: null }, strong), true);

// đã chấm điểm -> áp dụng đủ 3 bộ lọc
assert.equal(passesSignalFilters({ score: 90, dealType: "ngop_ngon", isNgoP: 85 }, strong), true);
assert.equal(passesSignalFilters({ score: 50, dealType: "ngop_ngon", isNgoP: 85 }, strong), false, "dưới minScore");
assert.equal(passesSignalFilters({ score: 90, dealType: "gia_cao", isNgoP: 85 }, strong), false, "sai dealType");
assert.equal(passesSignalFilters({ score: 90, dealType: "ngop_ngon", isNgoP: 20 }, strong), false, "Ngộp yếu");

// ngoPOnly lấy ngưỡng sub-score, khác hẳn cờ 0/1: 70 chưa đạt, 71 đã đạt
assert.equal(passesSignalFilters({ score: 90, dealType: "ngop_ngon", isNgoP: NGO_P_STRONG_THRESHOLD }, strong), false, "đúng ngưỡng là chưa đạt");
assert.equal(passesSignalFilters({ score: 90, dealType: "ngop_ngon", isNgoP: NGO_P_STRONG_THRESHOLD + 1 }, strong), true, "vượt ngưỡng là đạt");
// giá trị boolean cũ (1) nay không còn bị coi là Ngộp thật
assert.equal(passesSignalFilters({ score: 90, dealType: "ngop_ngon", isNgoP: 1 }, strong), false, "1 không phải Ngộp thật");

// dealTypes rỗng = không lọc theo loại giao dịch
assert.equal(passesSignalFilters({ score: 90, dealType: "binh_thuong", isNgoP: 85 }, { minScore: null, dealTypes: [], ngoPOnly: false }), true);

// minScore = 0 vẫn phải giữ tin điểm 0 (0 là điểm hợp lệ, không phải thiếu)
assert.equal(passesSignalFilters({ score: 0, dealType: "binh_thuong", isNgoP: 20 }, { minScore: 0, dealTypes: [], ngoPOnly: false }), true);
assert.equal(passesSignalFilters({ score: 0, dealType: "binh_thuong", isNgoP: 20 }, { minScore: 1, dealTypes: [], ngoPOnly: false }), false);

// isNgoP null (chưa biết) thì không loại
assert.equal(passesSignalFilters({ score: 90, dealType: "ngop_ngon", isNgoP: null }, strong), true);

// --- attachSignals: gắn tín hiệu theo external_id ---
const rows = [{ external_id: "111", score: null }, { external_id: "222", score: null }, { external_id: "999", score: null }];
const out = attachSignals(rows, idx, strong);
const byId = new Map(out.map((r) => [String(r.external_id), r]));
assert.equal(byId.get("111")?.score, 90);
assert.equal(byId.get("111")?.deal_type, "ngop_ngon");
assert.equal(byId.get("111")?.is_ngop, 85);
assert.equal(byId.get("111")?.scoring_available, true);
assert.equal(byId.get("222")?.score, null, "222 không có tín hiệu");
assert.equal(byId.get("222")?.scoring_available, false);
assert.equal(byId.get("999")?.score, null, "999 không có Check nào");

// gắn xong thì lọc: giữ 111 (đạt) + 999 (chưa chấm), bỏ 222? 222 không có nên vẫn giữ
const kept = out.filter((r) => passesSignalFilters(signalOf(r), strong));
assert.deepEqual(
  kept.map((r) => String(r.external_id)).sort(),
  ["111", "222", "999"],
  "chỉ tin đã chấm mà sai bộ lọc mới bị loại",
);

// bộ lọc thật sự loại tin đã chấm điểm thấp
const lowScore = attachSignals([{ external_id: "111" }], buildSignalIndex([
  { listing_url: "https://nhatot.com/tin/111.htm", score: 30, deal_type: "gia_cao", is_ngop: 10, created_at: "2026-01-01T00:00:00Z" },
]), strong);
assert.deepEqual(lowScore.filter((r) => passesSignalFilters(signalOf(r), strong)), []);

function signalOf(r: { score: unknown; deal_type: unknown; is_ngop: unknown }) {
  const score = typeof r.score === "number" ? r.score : null;
  return { score, dealType: typeof r.deal_type === "string" ? r.deal_type : null, isNgoP: typeof r.is_ngop === "number" ? r.is_ngop : null };
}

console.log("radar-signals: OK");