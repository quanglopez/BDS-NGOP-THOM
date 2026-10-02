// Tín hiệu Check cho Radar: nối listing -> Check gần nhất và lọc theo điểm.
// Nguyên tắc bất di bất dịch: tin CHƯA chấm điểm không bao giờ bị bộ lọc loại.
// Chỉ biết tin đã chấm mới đủ dữ liệu để phán đoán, nên thiếu dữ liệu = giữ.

export interface ListingSignal {
  score: number | null;
  dealType: string | null;
  isNgoP: number | null;
}

/** Tiêu chí lọc tuỳ chọn của Radar (mọi trường đều có thể thiếu). */
export interface SignalCriteria {
  minScore?: number | null;
  dealTypes?: readonly string[] | null;
  ngoPOnly?: boolean;
}

interface CheckSignalRow {
  listing_url?: unknown;
  score?: unknown;
  deal_type?: unknown;
  is_ngop?: unknown;
  created_at?: unknown;
}

const LISTING_ID = /(\d+)\.htm(?:$|[?#])/;

/**
 * checks.is_ngop là sub-score Ngộp trên thang 0..100 (Jev trả noul 0..1,
 * lưu xuống đã scale), KHÔNG phải cờ boolean. Ngưỡng "Ngộp thật" lấy đúng
 * quy ước sẵn có của lib/scoring.ts: ngop > 70.
 */
export const NGO_P_STRONG_THRESHOLD = 70;

/**
 * Lấy id listing từ URL Check. URL Check dạng SEO slug
 * (…/cho-thue-nha-dat-…-2037534871.htm), listing dạng /tin/2037534871.htm —
 * nên phải bóc số cuối trước .htm, không so khớp toàn URL.
 */
export function listingIdFromUrl(url: unknown): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  const hit = LISTING_ID.exec(url);
  return hit ? hit[1] : null;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Dựng map id listing -> tín hiệu của Check MỚI NHẤT.
 * created_at so sánh chuỗi ISO nên đúng thứ tự thời gian.
 */
export function buildSignalIndex(
  rows: readonly CheckSignalRow[] | null | undefined,
): Map<string, ListingSignal> {
  const index = new Map<string, ListingSignal>();
  if (!Array.isArray(rows)) return index;

  const newestAt = new Map<string, string>();
  for (const row of rows) {
    if (!row) continue;
    const id = listingIdFromUrl(row.listing_url);
    if (!id) continue;

    const at = typeof row.created_at === "string" ? row.created_at : "";
    const prev = newestAt.get(id);
    if (prev !== undefined && prev > at) continue;

    newestAt.set(id, at);
    index.set(id, {
      score: toNumberOrNull(row.score),
      dealType: toStringOrNull(row.deal_type),
      isNgoP: toNumberOrNull(row.is_ngop),
    });
  }
  return index;
}

/**
 * Tin chưa chấm điểm (hoặc chưa có tín hiệu nào) luôn qua bộ lọc.
 * Trường tín hiệu lẻ như dealType/isNgoP bị null cũng không loại, vì đó là
 * "chưa biết" chứ không phải "không đạt".
 */
export function passesSignalFilters(
  signals: ListingSignal | null | undefined,
  criteria: SignalCriteria = {},
): boolean {
  if (!signals || signals.score === null) return true;

  if (
    typeof criteria.minScore === "number" &&
    Number.isFinite(criteria.minScore) &&
    signals.score < criteria.minScore
  ) {
    return false;
  }

  const dealTypes = criteria.dealTypes;
  if (
    Array.isArray(dealTypes) &&
    dealTypes.length > 0 &&
    signals.dealType !== null &&
    !dealTypes.includes(signals.dealType)
  ) {
    return false;
  }

  if (
    criteria.ngoPOnly === true &&
    signals.isNgoP !== null &&
    signals.isNgoP <= NGO_P_STRONG_THRESHOLD
  ) {
    return false;
  }

  return true;
}

/** Bản ghi listing sau khi gắn tín hiệu Check. external_id là tuỳ chọn vì
 *  dữ liệu Supabase chưa khai báo kiểu, và thiếu id thì chỉ bỏ qua gắn tín hiệu. */
type WithExternalId = { external_id?: unknown };

/** Bản ghi listing đã gắn tín hiệu: score/deal_type/is_ngop gọn từ Check. */
export type RowWithSignals<T> = T & {
  score: number | null;
  deal_type: string | null;
  is_ngop: number | null;
  scoring_available: boolean;
};

/**
 * Gắn tín hiệu Check vào từng listing theo external_id, đồng thời lọc bằng
 * tiêu chí của Radar. Tin không có Check giữ nguyên score=null và
 * scoring_available=false, và vẫn được giữ lại.
 */
export function attachSignals<T extends WithExternalId>(
  rows: readonly T[],
  index: Map<string, ListingSignal>,
  criteria: SignalCriteria = {},
): RowWithSignals<T>[] {
  const out: RowWithSignals<T>[] = [];

  for (const row of rows) {
    if (!row) continue;
    const id = row.external_id === null || row.external_id === undefined ? null : String(row.external_id);
    const signals = id ? index.get(id) : undefined;

    if (!passesSignalFilters(signals, criteria)) continue;

    out.push({
      ...row,
      score: signals?.score ?? null,
      deal_type: signals?.dealType ?? null,
      is_ngop: signals?.isNgoP ?? null,
      scoring_available: signals?.score != null,
    });
  }

  return out;
}