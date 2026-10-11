// Bulk Prioritized Call Queue (PHASE 5) — câu chữ cho hàng đợi ưu tiên gọi.
//
// Toàn bộ nội dung ở đây là TEMPLATE TẤT ĐỊNH. Không gọi AI, không sinh văn bản
// tự do. Mỗi câu chỉ diễn giải lại con số / phân loại mà /api/check đã trả.
//
// Ranh giới câu chữ:
// - Đây là thứ tự ƯU TIÊN GỌI trong lô vừa chấm, KHÔNG phải khuyến nghị đầu tư.
// - Tín hiệu "ngộp" nghĩa là CẦN XÁC MINH SỚM, không phải "kèo ngon".
// - Không khẳng định pháp lý an toàn, không khẳng định danh tính người bán,
//   không hứa lợi nhuận.

import type { CallQueueBand, QueueInputRow } from "./queue";

export const BAND_LABEL: Record<CallQueueBand, string> = {
  call_first: "GỌI TRƯỚC",
  consider: "CÂN NHẮC",
  later: "ĐỂ SAU",
};

export const BAND_NOTE: Record<CallQueueBand, string> = {
  call_first: "Điểm từ 80 trở lên theo thang điểm CheckBDS hiện có.",
  consider: "Điểm từ 50 đến 79.",
  later: "Điểm dưới 50.",
};

/** Tiêu đề khu vực hàng đợi. */
export const QUEUE_HEADING = "Ưu tiên gọi";
export const RETRY_HEADING = "Cần thử lại";
export const ORIGINAL_VIEW_LABEL = "Kết quả gốc";
export const QUEUE_VIEW_LABEL = "Ưu tiên gọi";

/**
 * Câu giải thích phạm vi. Bắt buộc hiển thị cùng hàng đợi: nói rõ thứ tự chỉ
 * trong lô vừa chấm và không phải khuyến nghị đầu tư.
 */
export const QUEUE_SCOPE_NOTE =
  "Thứ tự này giúp bạn chọn tin nên kiểm tra/gọi trước, dựa trên điểm CheckBDS hiện có và chỉ trong lô tin bạn vừa chấm. Không phải khuyến nghị đầu tư.";

export const RETRY_NOTE =
  "Những tin này chưa có kết quả nên chưa xếp hạng được. Chưa phân tích không có nghĩa là tin kém.";

/** Thang điểm dùng để chia nhóm — nêu rõ để người đọc hiểu vì sao có nhóm. */
export const BAND_SCALE_NOTE = "Nhóm theo điểm CheckBDS: từ 80 là GỌI TRƯỚC, 50–79 là CÂN NHẮC, dưới 50 là ĐỂ SAU.";

/**
 * Cảnh báo pháp lý hiển thị NGAY TRÊN CARD khi phân loại là rui_ro_phap_ly.
 *
 * Cần thiết vì thứ hạng vẫn ưu tiên điểm: một tin 90 điểm có cờ rủi ro pháp lý
 * vẫn đứng trên tin 80 điểm bình thường (điểm là tiêu chí chính). Nhưng nếu card
 * chỉ hiện điểm cao màu "tốt" thì người đọc sẽ hiểu sai thành tin này ổn về pháp
 * lý. Đây đúng là quy ước đã có ở `lib/format.ts` → `scoreRingClass()`: rủi ro
 * pháp lý không bao giờ được nhìn như trạng thái tốt, kể cả khi điểm cao.
 */
export const LEGAL_RISK_WARNING =
  "Có phân loại rủi ro pháp lý trong dữ liệu hiện có. Điểm cao không thay thế việc tự kiểm tra sổ và quy hoạch.";

/** Câu hỏi bắt buộc cho tin có cờ rủi ro pháp lý. */
export const LEGAL_RISK_ASK = "Hỏi kỹ pháp lý: sổ đứng tên ai, quy hoạch, thế chấp.";

/**
 * Lớp badge điểm cho card hàng đợi.
 *
 * Theo đúng quy ước `scoreRingClass()` của repo: rủi ro pháp lý LUÔN hiện màu
 * rủi ro cao, bất kể điểm — nên điểm cao không bị đọc thành "tin tốt".
 * Không sửa `lib/format.ts`; đây là helper cục bộ của Phase 5.
 */
export function queueScoreBadgeClass(score: number, dealType: string | null): string {
  if (dealType === "rui_ro_phap_ly") return "bg-risk-high text-white";
  if (score >= 80) return "bg-ai-ink text-white";
  if (score >= 50) return "bg-risk-medium text-white";
  return "bg-risk-high text-white";
}

/** Tin này có cờ rủi ro pháp lý không? */
export function hasLegalRisk(dealType: string | null): boolean {
  return dealType === "rui_ro_phap_ly";
}

// ---------------------------------------------------------------- guard

/**
 * Cụm từ KHÔNG được xuất hiện trong bất kỳ câu nào do module này sinh ra.
 * Bao gồm mọi cách biến thứ tự gọi thành lời hứa về kết quả, danh tính, hay
 * pháp lý.
 */
export const FORBIDDEN_QUEUE_CLAIMS = [
  "chắc thắng",
  "chắc chắn nên mua",
  "deal tốt nhất",
  "tin thật",
  "chính chủ thật",
  "chủ thật",
  "giá hời chắc chắn",
  "pháp lý sạch",
  "an toàn",
  "thanh khoản chắc chắn",
  "đã xác minh",
  "verified",
  "đảm bảo sinh lời",
  "kèo ngon",
  "kèo hời",
] as const;

// ---------------------------------------------------------------- reasons

/**
 * Lý do ngắn vì sao tin này ở thứ hạng này. Chỉ diễn giải số liệu đã có.
 *
 * Thứ tự câu phản ánh đúng trọng số trong hợp đồng xếp hạng: điểm trước, rồi
 * tới cờ rủi ro pháp lý, rồi tín hiệu ngộp.
 */
export function buildReasons(row: QueueInputRow): string[] {
  const out: string[] = [];

  if (typeof row.score === "number") {
    out.push(`Điểm tổng ${row.score}/100 theo thang điểm CheckBDS.`);
  }

  if (hasLegalRisk(row.dealType)) {
    // Cờ pháp lý được nêu NGAY, kể cả khi điểm cao và thứ hạng cao — điểm là
    // tiêu chí xếp hạng chính, nhưng không được che mất cảnh báo pháp lý.
    out.push(LEGAL_RISK_WARNING);
  } else if (typeof row.legalSafety === "number" && row.legalSafety >= 70) {
    out.push("Ít dấu hiệu rủi ro pháp lý hơn trong dữ liệu hiện có.");
  }

  if (typeof row.isNgop === "number" && row.isNgop >= 60) {
    out.push("Có tín hiệu cần xác minh sớm.");
  }

  if (row.dealType === "gia_cao") {
    out.push("Phân loại cho thấy giá chào cao hơn mặt bằng trong dữ liệu hiện có.");
  }

  if (out.length === 0) {
    out.push("Đã có điểm CheckBDS, chưa có thêm tín hiệu nổi bật khác trong dữ liệu hiện có.");
  }

  return out;
}

/**
 * Câu hỏi nên hỏi ngay khi gọi. Template theo phân loại, không sinh bằng AI.
 */
export function buildAskPrompt(row: QueueInputRow): string {
  if (hasLegalRisk(row.dealType)) {
    return LEGAL_RISK_ASK;
  }
  if (row.dealType === "gia_cao") {
    return "Hỏi lại giá chào và biên độ thương lượng.";
  }
  return "Hỏi sổ đứng tên ai, lý do bán và giá còn đúng không.";
}

/** Tiêu đề tóm tắt: "17/20 tin đã phân tích · 3 tin cần thử lại". */
export function buildQueueSummary(completed: number, retry: number, total: number): string {
  return `${completed}/${total} tin đã phân tích · ${retry} tin cần thử lại`;
}

/**
 * Nhãn trạng thái cho dòng chưa xếp hạng, để "chưa phân tích" không bị đọc
 * thành "tin kém".
 */
export function retryStatusLabel(row: QueueInputRow): string {
  if (row.status === "stopped") return "Chưa chạy do hết lượt";
  if (row.status === "running") return "Đang chạy";
  if (row.status === "pending") return "Chưa chạy";
  if (row.error) return row.error;
  return "Chưa có kết quả";
}
