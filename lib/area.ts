// Trích diện tích đất từ text tin rao, và chuẩn hoá số đã có sẵn từ /api/extract.
//
// VÌ SAO CẦN FILE RIÊNG: regex cũ `/(\d+)\s*m2/` bắt nhầm số CUỐI trong dải
// diện tích. Với "Diện tích từ: 62-82,5-105,5m2" nó ra 5, nên area_m2 = 5,
// price_per_m2 sai ~13 lần và size band rơi xuống 3-8 m2 — crawl không còn tin
// nào để lấy mẫu. Sai số diện tích làm hỏng cả nhóm tham chiếu.
//
// Ưu tiên trong app/api/check: số CÓ CẤU TRÚC do /api/extract trả về (area_hint).
// Hàm ở đây chỉ là dự phòng cho tin khách dán tay (không qua gateway).

/** Trên trần hợp lý: 100.000 m2 là đất rất lớn, số lớn hơn là lỗi parse. */
const AREA_MAX_M2 = 100_000;

/**
 * Số trước "m2"/"m²" chỉ hợp lệ khi KHÔNG đứng sau:
 *   - chữ số      -> phần cuối của số dài hơn (105 trong 105m2)
 *   - dấu phẩy    -> phần thập phân bị cắt (5 trong 105,5m2)
 *   - dấu chấm    -> phần thập phân bị cắt (5 trong 105.5m2)
 *   - dấu gạch nối -> phần tử thứ hai của một DẢI (82,5 trong 62-82,5m2)
 * Dải diện tích -> trả null, KHÔNG đoán lấy một số bất kỳ trong dải.
 */
// KHÔNG dùng cờ g: String.match() với /g trả về mảng chỉ gồm full match,
// làm mất group bắt số.
const AREA_M2_RE = /(?<![\d.,-])(\d+(?:[.,]\d+)?)\s*m(?:2|²)/i;

function inRange(n: number): number | null {
  return Number.isFinite(n) && n > 0 && n <= AREA_MAX_M2 ? n : null;
}

/**
 * Diện tích (m2) từ text tin rao. null khi không chắc chắn.
 *
 * "Diện tích: 66 m2"        -> 66
 * "105,5m2"                 -> 105.5
 * "Diện tích từ: 62-82,5-105,5m2" -> null  (là dải, không phải một diện tích)
 */
export function extractAreaM2(text: string): number | null {
  if (!text) return null;
  const m = text.match(AREA_M2_RE);
  if (!m) return null;
  return inRange(Number(m[1].replace(",", ".")));
}

/**
 * Chuẩn hoá area_hint do /api/extract trả về ("66 m²", "66", 66) -> số m2.
 * Ưu tiên hàm này trước extractAreaM2 vì nó là dữ liệu có cấu trúc.
 */
export function parseAreaHint(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  // Chỉ lấy SỐ đầu tiên trong chuỗi. Không lấy bằng replace(/[^\d.,]/g) vì
  // "66 m2" sẽ ra "662" (số 2 của "m2" dính vào).
  const m = String(raw).match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  let n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n)) {
    // Dấu chấm dùng làm dấu phân cách nghìn ("1.200") -> bỏ hết dấu.
    n = Number(m[1].replace(/[.,]/g, ""));
  }
  return inRange(n);
}

/**
 * Diện tích để dùng: ưu tiên số có cấu trúc, không có thì mới quét text.
 * Trả [diện tích, nguồn] để log/ghi nhận biết mình đang dùng nguồn nào.
 */
export function resolveAreaM2(
  text: string,
  areaHint?: unknown,
): { areaM2: number | null; source: "hint" | "text" | "none" } {
  const hint = parseAreaHint(areaHint);
  if (hint != null) return { areaM2: hint, source: "hint" };
  const fromText = extractAreaM2(text);
  if (fromText != null) return { areaM2: fromText, source: "text" };
  return { areaM2: null, source: "none" };
}
