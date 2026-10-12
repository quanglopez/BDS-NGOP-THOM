// So sánh 2 tin BĐS (PHASE 7) — parser giá niêm yết thuần máy.
//
// VÌ SAO KHÔNG DÙNG LẠI REGEX GIÁ CŨ: lib/scoring.ts, lib/check-route.ts,
// lib/html-extract.ts parse giá cho MỘT tin trong luồng chấm điểm, nơi sai số
// chấp nhận được. Công cụ so sánh 2 tin thì khác: mức giá và chênh lệch được
// HIỂN THỊ nguyên văn cho người đọc, nên parser ở đây phải tự chặt:
//   - tách rõ total / per_m2 / range / ambiguous / none
//   - nhiều mức giá khác nhau trong MỘT tin => ambiguous, KHÔNG tự chọn một
//   - "80 triệu/m²" là đơn giá, KHÔNG phải giá bán cả căn
//   - giữ nguyên quote gốc (dấu, hoa/thường) qua bảng ánh xạ của Phase 4
//
// THUẦN + ĐỒNG BỘ: không fetch, không await, không Supabase, không React.

import { normalizeWithMap, type NormalizedListing } from "@/lib/owner-signals/normalize";

export type PriceParse =
  | { kind: "total"; valueVnd: number; quote: string }
  | { kind: "per_m2"; valueVndPerM2: number; quote: string }
  | { kind: "range"; minVnd: number; maxVnd: number; quote: string }
  | { kind: "ambiguous" }
  | { kind: "none" };

/** Trần hợp lý: 2.000 tỷ VND — lớn hơn là lỗi parse, không phải giá. */
export const MAX_VND = 2_000_000_000_000;

/**
 * Đọc một token số viết kiểu Việt.
 *
 * Quy tắc thống nhất cho cả tỷ lẫn triệu:
 *   - không có dấu phân cách            -> số nguyên ("4800")
 *   - một dấu, phần sau 1–2 chữ số     -> THẬP PHÂN ("4,8" / "1,25")
 *   - một dấu, phần sau nhóm 3 chữ số  -> PHÂN CÁCH NGHÌN ("1.200", "4,800")
 *   - nhiều dấu -> phải đúng nhóm 3 ("1.200.000"), sai -> null
 *
 * Quy tắc "3 chữ số sau dấu = phân cách nghìn" cho triệu/tr là bắt buộc của
 * hợp đồng Phase 7 ("1.200 triệu" là 1,2 tỷ, không phải 1.2 triệu).
 */
export function parseNumberToken(raw: string): number | null {
  // Chỉ nhận chuỗi gồm chữ số và dấu . , ; phải có ít nhất một chữ số.
  if (!/^[\d.,]+$/.test(raw) || !/\d/.test(raw)) return null;
  const seps = raw.match(/[.,]/g)?.length ?? 0;
  if (seps === 0) return Number(raw);
  if (seps === 1) {
    const [int, frac] = raw.split(/[.,]/);
    if (frac.length >= 3 && frac.length % 3 === 0) return Number(int + frac);
    if (frac.length <= 2) return Number(`${int}.${frac}`);
    return null;
  }
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(raw)) return Number(raw.replace(/[.,]/g, ""));
  return null;
}

/** Hệ số nhân theo đơn vị, trên bản ĐÃ CHUẨN HOÁ (bỏ dấu). */
const UNIT_MUL: Record<string, number> = { ty: 1e9, ti: 1e9, trieu: 1e6, tr: 1e6 };

// Regex chạy trên bản chuẩn hoá của Phase 4 (bỏ dấu, lowercase).
// "trieu" đứng trước "tr" trong alternation để không cắt cụm sai.
// "m²" giữ nguyên ký tự ² vì NFD không tách rời nó.
//
// S-1: mọi nhóm số có negative lookbehind (?<![\d.,a-z]) — từ chối khi số bị
// digit/dấu/chữ DÍNH NGAY TRƯỚC. "12.34.567 triệu" không còn được cứu vớt
// bằng cách khớp đuôi "34.567 triệu"; số dính vào chữ ("abc34") cũng bị loại.
const PER_M2_RE =
  /(?<![\d.,a-z])(\d+(?:[.,]\d+)?)\s*(trieu|tr|ty|ti)\s*\/\s*m(?:2|²|\^2)?(?![a-z0-9])/g;
const RANGE_RE =
  /(?<![\d.,a-z])(\d+(?:[.,]\d+)?)\s*(?:-|–|—|~|\bden\b|\btoi\b)\s*(\d+(?:[.,]\d+)?)\s*(trieu|tr|ty|ti)(?![a-z0-9])/g;
const N_TY_M_RE = /(?<![\d.,a-z])(\d+)\s*(ty|ti)\s+(\d{2,3})(?!\d)/g;
const TOTAL_RE =
  /(?<![\d.,a-z])(\d+(?:[.,]\d+)?)\s*(trieu|tr|ty|ti)(?![a-z0-9])/g;

/** Một vùng text bị coi là giá, kèm loại. Tọa độ theo bản CHUẨN HOÁ. */
export interface PriceSpan {
  start: number;
  end: number;
  kind: "total" | "range" | "per_m2";
}

export interface PriceAnalysis {
  parse: PriceParse;
  /** Mọi vùng giá đã khớp (kể cả ứng viên bị loại khỏi parse cuối) — dùng để loại khỏi phần so sánh câu chữ. */
  spans: PriceSpan[];
}

function overlaps(at: number, len: number, spans: readonly PriceSpan[]): boolean {
  return spans.some((s) => at < s.end && s.start < at + len);
}

/**
 * Phân tích giá trong MỘT tin.
 *
 * Thứ tự quét quan trọng: per_m2 -> range -> "N tỷ M" -> total thường.
 * Mỗi bước loại vùng đã khớp bước trước để "80 triệu/m²" không bị đếm thành
 * giá bán, và "5 tỷ" trong "4-5 tỷ" không thành giá riêng.
 */
export function analyzePrices(original: string, listing: NormalizedListing): PriceAnalysis {
  const norm = listing.normalized;
  const spans: PriceSpan[] = [];
  const perM2: Array<{ v: number; span: PriceSpan }> = [];
  const ranges: Array<{ min: number; max: number; span: PriceSpan }> = [];
  const totals: Array<{ v: number; span: PriceSpan }> = [];

  const quote = (span: PriceSpan): string =>
    original
      .slice(listing.map[span.start], listing.endMap[span.end - 1])
      .replace(/\s+/g, " ")
      .trim();

  for (const m of norm.matchAll(PER_M2_RE)) {
    const at = m.index;
    const num = parseNumberToken(m[1]);
    const mul = UNIT_MUL[m[2]];
    const v = num != null && mul ? num * mul : null;
    if (v == null || v <= 0 || v > MAX_VND) continue;
    const span = { start: at, end: at + m[0].length, kind: "per_m2" as const };
    spans.push(span);
    perM2.push({ v, span });
  }

  for (const m of norm.matchAll(RANGE_RE)) {
    const at = m.index;
    const len = m[0].length;
    if (overlaps(at, len, spans)) continue;
    const a = parseNumberToken(m[1]);
    const b = parseNumberToken(m[2]);
    const mul = UNIT_MUL[m[3]];
    if (a == null || b == null || !mul) continue;
    const lo = a * mul;
    const hi = b * mul;
    if (!(lo > 0 && hi > 0 && lo <= MAX_VND && hi <= MAX_VND)) continue;
    const span = { start: at, end: at + len, kind: "range" as const };
    spans.push(span);
    ranges.push({ min: Math.min(lo, hi), max: Math.max(lo, hi), span });
  }

  // "4 tỷ 800" = 4 tỷ + 800 triệu. Chỉ áp khi KHÔNG theo ngữ cảnh m².
  for (const m of norm.matchAll(N_TY_M_RE)) {
    const at = m.index;
    const len = m[0].length;
    if (overlaps(at, len, spans)) continue;
    if (/\/\s*m/.test(norm.slice(at + len, at + len + 6))) continue;
    const n = Number(m[1]);
    const tail = Number(m[3]);
    if (!Number.isFinite(n) || !Number.isFinite(tail)) continue;
    const v = n * 1e9 + tail * 1e6;
    if (v <= 0 || v > MAX_VND) continue;
    const span = { start: at, end: at + len, kind: "total" as const };
    spans.push(span);
    totals.push({ v, span });
  }

  for (const m of norm.matchAll(TOTAL_RE)) {
    const at = m.index;
    const len = m[0].length;
    if (overlaps(at, len, spans)) continue;
    const num = parseNumberToken(m[1]);
    const mul = UNIT_MUL[m[2]];
    const v = num != null && mul ? num * mul : null;
    if (v == null || v <= 0 || v > MAX_VND) continue;
    const span = { start: at, end: at + len, kind: "total" as const };
    spans.push(span);
    totals.push({ v, span });
  }

  // Nhiều mức giá khác nhau trong một tin -> ambiguous, không tự chọn.
  const distinct = [...new Set(totals.map((t) => t.v))];
  if (distinct.length >= 2) return { parse: { kind: "ambiguous" }, spans };
  if (distinct.length === 1) {
    const first = totals.find((t) => t.v === distinct[0]);
    if (first) return { parse: { kind: "total", valueVnd: first.v, quote: quote(first.span) }, spans };
  }
  if (ranges.length > 0) {
    const r = ranges[0];
    return { parse: { kind: "range", minVnd: r.min, maxVnd: r.max, quote: quote(r.span) }, spans };
  }
  if (perM2.length > 0) {
    const p = perM2[0];
    return { parse: { kind: "per_m2", valueVndPerM2: p.v, quote: quote(p.span) }, spans };
  }
  return { parse: { kind: "none" }, spans };
}

/** Tiện ích cho test và caller chỉ cần parse. */
export function parseListingPrice(original: string): PriceParse {
  return analyzePrices(original, normalizeWithMap(original)).parse;
}

/** "400000000" -> "400 triệu"; "1400000000" -> "1,4 tỷ". Dấu thập phân kiểu Việt. */
export function formatVndShort(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "0";
  if (v >= 1_000_000_000) {
    const t = Math.round((v / 1_000_000_000) * 100) / 100;
    return `${String(t).replace(".", ",")} tỷ`;
  }
  const m = Math.round((v / 1_000_000) * 10) / 10;
  return `${String(m).replace(".", ",")} triệu`;
}

/** Chênh lệch tương đối giữa hai mức giá, công thức đối xứng, LUÔN 1 chữ số thập phân. */
export function pctText(a: number, b: number): string {
  const mid = (a + b) / 2;
  if (!(mid > 0)) return "0,0";
  const pct = (Math.abs(a - b) / mid) * 100;
  return (Math.round(pct * 10) / 10).toFixed(1).replace(".", ",");
}
