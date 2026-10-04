// Chống regression: null contract cho score / deal_type.
// Case gốc: tin chưa chấm điểm (score null) bị render thành "0",
// badge đỏ, nhãn "BÌNH THƯỜNG" — tức giả dữ liệu. Null phải hiện
// "CHƯA CÓ NHẬN ĐỊNH" và badge trung tính (lib/radar/signals.ts: null ≠ 0/false).
//
// Cập nhật: `DEAL_LABELS[deal] ?? "BÌNH THƯỜNG"` cũng từng là dữ liệu giả —
// giá trị lạ (model đổi nhãn, dữ liệu cũ) hiện ra thành "BÌNH THƯỜNG",
// tức tin CHƯA được ai phân loại lại hiện như tin đã phân loại là bình thường.
// Cả null lẫn giá trị lạ giờ đều về cùng nhãn "CHƯA CÓ NHẬN ĐỊNH".
import { strict as assert } from "node:assert";
import { dealBadgeClass, dealLabel, DEAL_UNKNOWN_LABEL, scoreBadgeClass } from "../lib/format.ts";

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

console.log("\n== dealLabel: kèo đã phân loại ==");

check("ngop_ngon -> 'KÈO NGỘP NGON'", () => {
  assert.equal(dealLabel("ngop_ngon"), "KÈO NGỘP NGON");
});

check("thom_dau_tu -> 'TIỀM NĂNG CAO'", () => {
  assert.equal(dealLabel("thom_dau_tu"), "TIỀM NĂNG CAO");
});

check("binh_thuong -> 'BÌNH THƯỜNG'", () => {
  assert.equal(dealLabel("binh_thuong"), "BÌNH THƯỜNG");
});

check("chuoi khong biet -> 'CHƯA CÓ NHẬN ĐỊNH' (KHÔNG phải BÌNH THƯỜNG)", () => {
  // Giá trị lạ = chưa ai phân loại, KHÁC "bình thường". Rơi về "BÌNH THƯỜNG"
  // là bịa kết luận cho tin chưa được đánh giá.
  assert.equal(dealLabel("anything_else"), DEAL_UNKNOWN_LABEL);
  assert.notEqual(dealLabel("anything_else"), "BÌNH THƯỜNG");
});

console.log("\n== dealLabel: null = chưa có nhận định, không phải BÌNH THƯỜNG ==");

check("null -> 'CHƯA CÓ NHẬN ĐỊNH'", () => {
  assert.equal(dealLabel(null), DEAL_UNKNOWN_LABEL);
  assert.equal(dealLabel(null), "CHƯA CÓ NHẬN ĐỊNH");
});

check("undefined -> 'CHƯA CÓ NHẬN ĐỊNH'", () => {
  assert.equal(dealLabel(undefined), DEAL_UNKNOWN_LABEL);
});

check("chuoi rong -> 'CHƯA CÓ NHẬN ĐỊNH'", () => {
  assert.equal(dealLabel(""), DEAL_UNKNOWN_LABEL);
});

check("null và giá trị lạ cho CÙNG nhãn (cùng nghĩa: chưa biết)", () => {
  assert.equal(dealLabel(null), dealLabel("gia_tri_la"));
});

console.log("\n== scoreBadgeClass: 0 là điểm thật, không phải null ==");

check("90 -> emerald", () => {
  assert.equal(scoreBadgeClass(90), "bg-emerald-600 text-white");
});

check("80 -> emerald (ngưỡng)", () => {
  assert.equal(scoreBadgeClass(80), "bg-emerald-600 text-white");
});

check("60 -> amber", () => {
  assert.equal(scoreBadgeClass(60), "bg-amber-400 text-amber-950");
});

check("50 -> amber (ngưỡng)", () => {
  assert.equal(scoreBadgeClass(50), "bg-amber-400 text-amber-950");
});

check("20 -> red", () => {
  assert.equal(scoreBadgeClass(20), "bg-red-500 text-white");
});

check("0 -> red (điểm 0 là thật, không phải chưa chấm)", () => {
  assert.equal(scoreBadgeClass(0), "bg-red-500 text-white");
});

console.log("\n== scoreBadgeClass: null -> badge trung tính ==");

check("null -> slate trung tính", () => {
  assert.equal(scoreBadgeClass(null), "bg-slate-200 text-slate-500");
});

check("undefined -> slate trung tính", () => {
  assert.equal(scoreBadgeClass(undefined), "bg-slate-200 text-slate-500");
});

console.log("\n== dealBadgeClass: null -> trung tính ==");

check("null -> slate trung tính", () => {
  assert.equal(dealBadgeClass(null), "bg-slate-200 text-slate-600");
});

check("ngop_ngon / thom_dau_tu -> emerald", () => {
  assert.equal(dealBadgeClass("ngop_ngon"), "bg-emerald-600 text-white");
  assert.equal(dealBadgeClass("thom_dau_tu"), "bg-emerald-600 text-white");
});

check("gia_cao / rui_ro_phap_ly -> red", () => {
  assert.equal(dealBadgeClass("gia_cao"), "bg-red-600 text-white");
  assert.equal(dealBadgeClass("rui_ro_phap_ly"), "bg-red-600 text-white");
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
