// Bulk Prioritized Call Queue (PHASE 5) — xếp thứ tự GỌI cho kết quả bulk đã chấm.
//
// Nguyên tắc:
// - THUẦN + ĐỒNG BỘ: không fetch, không await, không Supabase, không React.
//   Xếp hạng chỉ là tính toán trên dữ liệu đã có trong bộ nhớ client.
// - KHÔNG tạo điểm số mới. Điểm chính là investment_score mà /api/check đã trả.
//   Gộp các sub-score thành một "điểm ưu tiên" sẽ là bịa thêm tín hiệu.
// - KHÔNG đổi hành vi quota/AI. Hàm ở đây không gọi mạng.
// - "chưa phân tích" KHÁC "tin kém": dòng chưa có điểm không được xếp vào nhóm
//   thấp, mà vào danh sách CẦN THỬ LẠI.
//
// Đây là thứ tự ƯU TIÊN GỌI trong đúng lô tin người dùng vừa chấm — không phải
// khuyến nghị đầu tư, không xác minh danh tính, không xác minh pháp lý.

import { buildAskPrompt, buildReasons } from "./wording";

/** Nhóm ưu tiên, dùng đúng ngưỡng sản phẩm hiện có (80 / 50). */
export type CallQueueBand = "call_first" | "consider" | "later";

/**
 * Trạng thái xử lý của một dòng. Cần tường minh vì trước đây dòng chưa chạy và
 * dòng chạy lỗi đều có score null + error null, không phân biệt được.
 */
export type CallQueueStatus = "pending" | "running" | "completed" | "error" | "stopped";

/** Dòng đầu vào tối thiểu để xếp hạng. Không kéo kiểu UI/React vào module thuần. */
export interface QueueInputRow {
  /** Vị trí gốc trong file người dùng dán — khoá tie-break cuối cùng. */
  inputIndex: number;
  text: string;
  score: number | null;
  dealType: string | null;
  isNgop: number | null;
  legalSafety?: number | null;
  locationGrowth?: number | null;
  liquidity?: number | null;
  province?: string | null;
  priceBillion?: number | null;
  confidence?: number | null;
  analyzedAt?: string | null;
  cached?: boolean;
  /** URL tin gốc khi dòng nhập là link. null khi người dùng dán văn bản. */
  sourceUrl?: string | null;
  checkId?: string | null;
  seoSlug?: string | null;
  error?: string | null;
  status: CallQueueStatus;
}

export interface CallQueueItem {
  /** Thứ tự 1..N trong lô hiện tại. */
  rank: number;
  band: CallQueueBand;
  inputIndex: number;
  score: number;
  /** Câu giải thích ngắn vì sao tin này ở thứ hạng này. */
  reasons: string[];
  /** Một câu hỏi nên hỏi ngay khi gọi. */
  askPrompt: string;
  text: string;
  province: string | null;
  isNgop: number | null;
  legalSafety: number | null;
  dealType: string | null;
  cached: boolean;
  checkId: string | null;
  seoSlug: string | null;
  sourceUrl: string | null;
}

export interface CallQueueStats {
  completed: number;
  retry: number;
  total: number;
}

export interface CallQueueResult {
  ranked: CallQueueItem[];
  /** Dòng chưa xếp được: lỗi, bị dừng vì hết lượt, hoặc chưa chạy. */
  retry: QueueInputRow[];
  stats: CallQueueStats;
}

// --------------------------------------------------------------- eligibility

/**
 * Dòng đã chấm xong và dùng được để xếp hạng.
 *
 * `score === null` nghĩa là CHƯA có kết quả, không phải "0 điểm". Dòng lỗi cũng
 * không xếp hạng. Cả hai đi vào CẦN THỬ LẠI để người dùng biết còn việc phải làm.
 */
export function isRankable(row: QueueInputRow): boolean {
  if (row.status !== "completed") return false;
  if (typeof row.score !== "number" || !Number.isFinite(row.score)) return false;
  if (row.error) return false;
  return true;
}

// -------------------------------------------------------------------- ranking

/**
 * Cờ rủi ro pháp lý. 1 khi provider phân loại rui_ro_phap_ly.
 *
 * Chỉ là cờ 0/1 dùng để đẩy tin có rủi ro pháp lý xuống dưới khi điểm bằng nhau
 * — KHÔNG phải điểm số mới, và không trộn vào investment_score.
 */
export function criticalRiskFlags(row: QueueInputRow): number {
  return row.dealType === "rui_ro_phap_ly" ? 1 : 0;
}

/** null = chưa biết, phải xếp SAU giá trị đã biết (không quy về 0). */
function compareDescendingKnownLast(a: number | null, b: number | null): number {
  const aKnown = typeof a === "number" && Number.isFinite(a);
  const bKnown = typeof b === "number" && Number.isFinite(b);
  if (aKnown && bKnown) return (b as number) - (a as number);
  if (aKnown) return -1;
  if (bKnown) return 1;
  return 0;
}

/**
 * So sánh hai dòng đã đủ điều kiện xếp hạng.
 *
 * Hợp đồng thứ tự (dừng ngay khi có kết quả):
 *   1. investment_score DESC        — chất lượng theo điểm CheckBDS hiện có
 *   2. criticalRiskFlags ASC        — cùng điểm thì tin có cờ rủi ro pháp lý xuống dưới
 *   3. is_ngop DESC                 — tín hiệu cần xác minh sớm; null xếp sau
 *   4. inputIndex ASC               — bảo đảm thứ tự ổn định, tất định
 *
 * `is_ngop` chỉ là tie-break. Nó KHÔNG cộng vào điểm và KHÔNG có nghĩa "kèo ngon".
 */
export function compareQueueRows(a: QueueInputRow, b: QueueInputRow): number {
  const scoreDiff = (b.score as number) - (a.score as number);
  if (scoreDiff !== 0) return scoreDiff;

  const riskDiff = criticalRiskFlags(a) - criticalRiskFlags(b);
  if (riskDiff !== 0) return riskDiff;

  const ngopDiff = compareDescendingKnownLast(a.isNgop, b.isNgop);
  if (ngopDiff !== 0) return ngopDiff;

  return a.inputIndex - b.inputIndex;
}

/** Nhóm ưu tiên theo ngưỡng tuyệt đối của sản phẩm. */
export function bandForScore(score: number): CallQueueBand {
  if (score >= 80) return "call_first";
  if (score >= 50) return "consider";
  return "later";
}
// ------------------------------------------------------------------ build

/**
 * Dựng hàng đợi ưu tiên gọi từ kết quả bulk hiện có.
 *
 * KHÔNG sửa đầu vào: trả về mảng mới, dòng gốc giữ nguyên.
 * KHÔNG gọi mạng, KHÔNG đọc state ngoài tham số.
 */
export function buildCallQueue(rows: readonly QueueInputRow[]): CallQueueResult {
  const rankable: QueueInputRow[] = [];
  const retry: QueueInputRow[] = [];

  for (const row of rows) {
    if (isRankable(row)) rankable.push(row);
    else retry.push(row);
  }

  // Sắp trên BẢN SAO để không đụng mảng đầu vào.
  const sorted = [...rankable].sort(compareQueueRows);

  const ranked: CallQueueItem[] = sorted.map((row, i) => ({
    rank: i + 1,
    band: bandForScore(row.score as number),
    inputIndex: row.inputIndex,
    score: row.score as number,
    reasons: buildReasons(row),
    askPrompt: buildAskPrompt(row),
    text: row.text,
    province: row.province ?? null,
    isNgop: row.isNgop ?? null,
    legalSafety: row.legalSafety ?? null,
    dealType: row.dealType ?? null,
    cached: row.cached === true,
    checkId: row.checkId ?? null,
    seoSlug: row.seoSlug ?? null,
    sourceUrl: row.sourceUrl ?? null,
  }));

  return {
    ranked,
    retry,
    stats: {
      completed: ranked.length,
      retry: retry.length,
      total: rows.length,
    },
  };
}

/** Đếm số tin trong từng nhóm, dùng cho tiêu đề nhóm trên UI. */
export function countByBand(ranked: readonly CallQueueItem[]): Record<CallQueueBand, number> {
  const out: Record<CallQueueBand, number> = { call_first: 0, consider: 0, later: 0 };
  for (const item of ranked) out[item.band] += 1;
  return out;
}
