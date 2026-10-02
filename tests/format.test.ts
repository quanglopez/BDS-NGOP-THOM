// Chống regression: null contract cho score / deal_type.
// Case gốc: tin chưa chấm điểm (score null) bị render thành "0",
// badge đỏ, nhãn "BÌNH THƯỜNG" — tức giả dữ liệu. Null phải hiện
// "CHƯA CHẤM" và badge trung tính (lib/radar/signals.ts: null ≠ 0/false).
import { strict as assert } from "node:assert";
import { dealBadgeClass, dealLabel, scoreBadgeClass } from "../lib/format.ts";

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

check("chuoi khong biet -> 'BÌNH THƯỜNG'", () => {
  assert.equal(dealLabel("anything_else"), "BÌNH THƯỜNG");
});

console.log("\n== dealLabel: null = chưa chấm, không phải BÌNH THƯỜNG ==");

check("null -> 'CHƯA CHẤM'", () => {
  assert.equal(dealLabel(null), "CHƯA CHẤM");
});

check("undefined -> 'CHƯA CHẤM'", () => {
  assert.equal(dealLabel(undefined), "CHƯA CHẤM");
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
