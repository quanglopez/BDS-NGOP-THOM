// Chống regression formatter: đơn vị và dấu thập phân kiểu Việt Nam.
// Case gốc: price_per_m2 = 73333333 bị render thành "73.333.333 tr/m²".
import { strict as assert } from "node:assert";
import { fmtArea, fmtPpm2, fmtVnd } from "../lib/price/format.ts";

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

console.log("\n== Case bug goc (bat buoc) ==");

check("73333333 -> '73,3 trieu/m2'", () => {
  assert.equal(fmtPpm2(73_333_333), "73,3 triệu/m²");
});

check("3300000000/45 -> '73,3 trieu/m2'", () => {
  assert.equal(fmtPpm2(3_300_000_000 / 45), "73,3 triệu/m²");
});

// VND/m² -> triệu/m². Ba case nêu trong ticket sửa bug, khoá đúng hệ số
// 1_000_000 và hành vi làm tròn 1 chữ số thập phân kiểu Việt.
check("100000000 -> '100,0 trieu/m2'", () => {
  assert.equal(fmtPpm2(100_000_000), "100,0 triệu/m²");
});

check("85000000 -> '85,0 trieu/m2'", () => {
  assert.equal(fmtPpm2(85_000_000), "85,0 triệu/m²");
});

check("125500000 -> '125,5 trieu/m2'", () => {
  assert.equal(fmtPpm2(125_500_000), "125,5 triệu/m²");
});

check("VND tho ra nguyen duoc doi sang trieu, khong con 'tr/m2'", () => {
  // Bug goc: `${v.toLocaleString("vi-VN")} tr/m²` -> "100.000.000 tr/m²".
  // Phai doi don vi VÀ doi don vi hien thi.
  const out = fmtPpm2(100_000_000);
  assert.ok(!out.includes("tr/m²"), `van con "tr/m²": ${out}`);
  assert.ok(!out.includes("100.000.000"), `con so VND tho: ${out}`);
  assert.equal(out, "100,0 triệu/m²");
});

console.log("\n== Khong con 'tr/m2' va khong con dau cham thap phan ==");

check("mo gia tri ppm2 deu dung don vi va dau phay", () => {
  const cases = [
    0, 500_000, 20_000_000, 73_333_333, 73_333_333.33, 130_000_000,
    152_000_000, 175_000_000, 205_000_000, 3_300_000_000 / 45,
  ];
  for (const v of cases) {
    const out = fmtPpm2(v);
    assert.ok(!out.includes("tr/m²"), `${v} -> ${out} van dung "tr"`);
    // Dấu thập phân PHẢI là ","; "." chỉ được phép làm dấu phân cách nghìn.
    assert.ok(
      /^-?[\d.]*,\d triệu\/m²$/.test(out),
      `${v} -> "${out}" phai ket thuc bang dau phay + 1 chu so`,
    );
  }
});

check("73.333.333 khong bao gio xuat hien nguyen hinh", () => {
  assert.notEqual(fmtPpm2(73_333_333), "73.333.333 tr/m²");
  assert.notEqual(fmtPpm2(73_333_333), "73.3 tr/m²");
});

console.log("\n== Bien / bien doi ==");

check("null / undefined / NaN / Infinity -> '—'", () => {
  for (const v of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(fmtPpm2(v as number | null), "—");
    assert.equal(fmtVnd(v as number | null), "—");
    assert.equal(fmtArea(v as number | null), "—");
  }
});

check("gia tri bang 0 hien '0,0' chu khong phai '—'", () => {
  assert.equal(fmtPpm2(0), "0,0 triệu/m²");
  assert.equal(fmtVnd(0), "0 đ");
  assert.equal(fmtArea(0), "0 m²");
});

check("am -> giu dau am", () => {
  assert.equal(fmtPpm2(-73_333_333), "-73,3 triệu/m²");
});

console.log("\n== Tien mat ==");

check("VND -> tu / trieu / do, dau phay o phan thap phan", () => {
  assert.equal(fmtVnd(4_692_000_000), "4,7 tỷ");
  assert.equal(fmtVnd(4_692_000_000, 2), "4,69 tỷ");
  assert.equal(fmtVnd(1_234_567_890, 2), "1,23 tỷ");
  // Nhanh trieu luon la so nguyen: "469 trieu", khong phai "469,20 trieu".
  assert.equal(fmtVnd(469_200_000), "469 triệu");
  assert.equal(fmtVnd(469_200_000, 2), "469 triệu");
  assert.equal(fmtVnd(850_000), "850.000 đ");
  assert.equal(fmtVnd(1_000_000), "1 triệu");
});

check("dau cham chi xuat hien o phan tach nghin", () => {
  // "850.000 đ" / "1.000 đ" — cham la phan cach nghin, khong phai thap phan.
  assert.equal(fmtVnd(1_000), "1.000 đ");
  assert.equal(fmtVnd(1_000_000_000), "1 tỷ");
});

// Chip "💰 {fmtVnd(price)}" ở app/bao-cao/[id]/page.tsx:77. Bản cũ dùng
// `.toFixed(v % 1e9 === 0 ? 0 : 2)` -> 4300000000 ra "4.30 tỷ" (dấu chấm,
// dư số 0). Bản cũ nằm ở server component, nên commit c8041f8 sửa hai
// client component mà bỏ sót file này -> chip vẫn lỗi trên production.
check("chip hero: 4300000000 -> '4,3 tỷ' khong phai '4,30 tỷ'", () => {
  assert.equal(fmtVnd(4_300_000_000), "4,3 tỷ");
  assert.notEqual(fmtVnd(4_300_000_000), "4.30 tỷ");
  assert.notEqual(fmtVnd(4_300_000_000), "4,30 tỷ");
});

check("gia tron khong ghi du so 0", () => {
  assert.equal(fmtVnd(4_000_000_000), "4 tỷ");
  assert.equal(fmtVnd(7_000_000_000), "7 tỷ");
});

check("khong con so 0 thua cua toFixed(2) o nhanh tỷ", () => {
  // Bug goc: toFixed(2) sinh "4.50 tỷ" cho 4.5 tỷ — dấu chấm chứ không
  // phải dấu phẩy kiểu Việt, và luôn 2 chữ số thập phân.
  const out = fmtVnd(4_500_000_000);
  assert.equal(out, "4,5 tỷ");
  assert.ok(!out.includes("."), `dấu chấm phải chỉ dùng làm dấu tách nghìn: ${out}`);
});

console.log("\n== Dien tich ==");

check("m2 nhom nghin bang dau cham", () => {
  assert.equal(fmtArea(45), "45 m²");
  assert.equal(fmtArea(1_234), "1.234 m²");
  assert.equal(fmtArea(0), "0 m²");
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
