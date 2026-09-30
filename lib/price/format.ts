// Formatter tiền tệ/diện tích theo chuẩn Việt Nam:
//   phân cách nghìn = "."   thập phân = ","
// Không dùng toLocaleString/toFixed trần vì phụ thuộc ICU (Node ≠ browser,
// khó test, dễ lệch). group() thuần toán học nên deterministic ở mọi môi trường.

/** "1234567.5" -> "1.234.567,5" */
function group(fixed: string): string {
  const [int, frac] = fixed.split(".");
  const withDots = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return frac === undefined ? withDots : `${withDots},${frac}`;
}

function vi(v: number, fraction: number): string {
  return group(v.toFixed(fraction));
}

/** Như vi() nhưng bỏ số 0 thừa: 1.0 -> "1", 4.70 -> "4,7", 4.69 -> "4,69". */
function viTrim(v: number, fraction: number): string {
  const s = v.toFixed(fraction);
  if (!s.includes(".")) return group(s);
  return group(s.replace(/0+$/, "").replace(/\.$/, ""));
}

function bad(v: number | null | undefined): boolean {
  return v === null || v === undefined || !Number.isFinite(v);
}

/**
 * Giá trên m² từ backend là VND/m² (ví dụ 73333333).
 * Hiển thị triệu/m², 1 chữ số thập phân, dấu thập phân kiểu Việt.
 *   73333333 -> "73,3 triệu/m²"
 */
export function fmtPpm2(v: number | null | undefined): string {
  if (bad(v)) return "—";
  return `${vi(v as number / 1_000_000, 1)} triệu/m²`;
}

/**
 * Tiền mặt VND -> "4,7 tỷ" / "469 triệu" / "850.000 đ"
 * `fraction` chỉ áp dụng cho nhánh "tỷ". Nhánh "triệu" và "đ" luôn là số
 * nguyên vì đó là cách giá BĐS được nói ("469 triệu", không phải "469,20 triệu").
 */
export function fmtVnd(v: number | null | undefined, fraction = 1): string {
  if (bad(v)) return "—";
  const n = v as number;
  if (n >= 1_000_000_000) return `${viTrim(n / 1_000_000_000, fraction)} tỷ`;
  if (n >= 1_000_000) return `${vi(n / 1_000_000, 0)} triệu`;
  return `${vi(n, 0)} đ`;
}

/** Diện tích m² -> "1.234 m²" */
export function fmtArea(v: number | null | undefined): string {
  if (bad(v)) return "—";
  return `${vi(v as number, 0)} m²`;
}
