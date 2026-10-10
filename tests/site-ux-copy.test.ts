// Regression: copy phải nói rõ 3 giới hạn (Free scan 10, PRO scan 50, Bulk PRO 100)
// và header phải phân biệt đăng nhập/chưa.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

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

const header = readFileSync("components/site/header.tsx", "utf8");
const hero = readFileSync("components/site/hero.tsx", "utf8");
const page = readFileSync("app/page.tsx", "utf8");
const report = readFileSync("app/bao-cao/[id]/page.tsx", "utf8");
const category = readFileSync("components/dashboard/category-scan.tsx", "utf8");
const bulk = readFileSync("components/site/bulk-section.tsx", "utf8");

console.log("\n== site ux copy ==");

check("header fetch auth state", () => {
  assert.ok(header.includes('fetch("/api/payments/status")'));
  assert.ok(header.includes("Dashboard"));
  assert.ok(header.includes("SignOutButton"));
  assert.ok(header.includes("Đăng nhập"));
});

check("hero nói rõ 100 tin là PRO", () => {
  assert.ok(hero.includes("Tính năng PRO"));
  assert.ok(hero.includes("Bulk Check"));
  assert.ok(page.includes("(PRO)"));
});

check("H1 hứa lọc tin đáng gọi, 100 tin nằm ở PRO", () => {
  assert.ok(hero.includes("Biết tin nào đáng gọi trước khi mất thời gian gọi."));
  assert.ok(hero.includes("PRO: Lọc 100 tin BĐS trong 1 phút"));
  assert.ok(!hero.includes("<h1") || hero.indexOf("Biết tin nào đáng gọi") < hero.indexOf("PRO: Lọc 100 tin"));
  assert.ok(hero.includes('href="#kiem-tra"'));
  assert.ok(hero.includes("Dùng miễn phí – 20 tin/ngày"));
});

check("report score không emerald cho mọi điểm, có disclaimer", () => {
  assert.ok(report.includes("scoreRingClass"));
  assert.ok(report.includes("dealBadgeClass"));
  assert.ok(!report.includes("border-emerald-500 text-emerald-700"));
  assert.ok(report.includes("Điểm hỗ trợ lọc tin, không thay thế việc kiểm tra sổ và quy hoạch."));
});

check("category scan nêu đủ 10/50/100", () => {
  assert.ok(category.includes("Free {SCAN_LIMITS.free} tin/lần"));
  assert.ok(category.includes("PRO {SCAN_LIMITS.pro} tin/lần"));
  assert.ok(category.includes("Bulk Check PRO 100 tin/lần"));
});

check("bulk section nêu đủ 10/50/100", () => {
  assert.ok(bulk.includes("Free 10 tin/lần"));
  assert.ok(bulk.includes("PRO 50 tin/lần"));
  assert.ok(bulk.includes("Bulk Check PRO 100 tin/lần"));
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
