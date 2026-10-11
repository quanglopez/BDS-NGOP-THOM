// Urgency Verification Checklist (PHASE 6) — toàn bộ câu chữ hiển thị + guard.
//
// Tập trung một chỗ để test khoá được: mọi chuỗi người dùng đọc đều đi qua đây.
//
// Ranh giới quan trọng nhất: tool phân tích CÂU CHỮ, không xác minh lý do bán.
// "Tin dùng ngôn ngữ bán gấp" KHÁC "người bán đang kẹt tiền thật", và KHÁC
// "đây là deal tốt". Không có câu nào được nói hai điều sau.

import type { UrgencyLevel, UrgencyTopic } from "./signals";

export const LEVEL_LABEL: Record<UrgencyLevel, string> = {
  verify_soon: "DẤU HIỆU CẦN XÁC MINH SỚM",
  insufficient: "CHƯA CÓ ĐỦ DỮ LIỆU VỀ MỨC ĐỘ GẤP",
};

/** Giải thích ngắn cho từng mức. Nói rõ căn cứ là câu chữ. */
export const LEVEL_EXPLANATION: Record<UrgencyLevel, string> = {
  verify_soon:
    "Tin dùng ngôn ngữ bán gấp. Nên hỏi thêm trước khi coi đây là lý do bán thật.",
  insufficient:
    "Chưa thấy cụm từ thể hiện mức độ gấp rõ ràng trong nội dung tin. Điều này không có nghĩa là tin đáng nghi, cũng không có nghĩa là tin tốt.",
};

/** Câu giới hạn năng lực — BẮT BUỘC hiển thị trong mọi kết quả. */
export const LIMITATION =
  "CheckBDS chỉ phân tích câu chữ trong tin đăng, không xác minh lý do bán hay tình trạng tài chính của người bán.";

/** Nhắc rõ tín hiệu gấp không phải chất lượng đầu tư. */
export const URGENCY_NOT_QUALITY =
  "Bán gấp không có nghĩa là giá tốt hay deal hời. Tín hiệu này chỉ cho biết nên hỏi kỹ hơn.";

export const EVIDENCE_HEADING = "Cụm từ tìm thấy trong tin";
export const NO_EVIDENCE_NOTE =
  "Không tìm thấy cụm từ nào thể hiện mức độ gấp. Không có dấu hiệu không có nghĩa là tin đã được kiểm chứng.";

export const CHECKLIST_HEADING = "Nên hỏi gì để tự kiểm tra lý do bán";
export const CHECKLIST_NOTE =
  "Danh sách câu hỏi dưới đây giúp bạn tự xác minh khi gọi. Chúng không phải kết luận về người bán.";

export const WATCH_HEADING = "Dấu hiệu cần kiểm tra thêm khi trao đổi";
export const PHYSICAL_HEADING = "Việc cần đối chiếu trực tiếp";

/**
 * Checklist cố định — đây là phần sản phẩm chính, luôn hiển thị.
 */
export const CHECKLIST: readonly string[] = [
  "Lý do cụ thể cần bán nhanh là gì?",
  "Giá hiện tại có phải giá chốt không, còn thương lượng bao nhiêu?",
  "Tin đã đăng bao lâu, đã giảm giá mấy lần, từ mức nào xuống mức nào?",
  "Bao lâu cần hoàn tất giao dịch?",
  "Nếu không bán được trong thời hạn đó thì điều gì xảy ra?",
];

/**
 * Câu hỏi có điều kiện theo nhóm ngữ nghĩa tìm được. Mỗi nhóm chỉ thêm một câu,
 * nên không sinh câu trùng khi nhiều dấu hiệu cùng nhóm.
 */
export const CONDITIONAL_QUESTIONS: Record<UrgencyTopic, string> = {
  bank: "Khoản vay ngân hàng nào, dư nợ bao nhiêu, đã có văn bản giải chấp chưa?",
  loss: "Giá mua ban đầu là bao nhiêu so với giá đang bán?",
  price_cut: "Đã giảm từ mức nào, vì sao giảm?",
  transfer: "Đang sang hợp đồng thuê hay chuyển nhượng tài sản?",
  time_pressure: "Vì sao cần bán trong thời hạn đó, có mốc nào ràng buộc không?",
  distress_sale: "Việc cần bán nhanh bắt đầu từ khi nào, và điều gì khiến phải nhanh?",
};

/**
 * Thứ tự hiển thị câu hỏi có điều kiện, để kết quả ổn định và dễ đọc.
 */
export const TOPIC_ORDER: readonly UrgencyTopic[] = [
  "bank",
  "loss",
  "price_cut",
  "transfer",
  "time_pressure",
  "distress_sale",
];

/** Danh sách cố định những điểm cần để ý khi trao đổi. Cách nói thận trọng. */
export const WATCH_FOR: readonly string[] = [
  "Lý do chung chung, không có mốc thời gian cụ thể.",
  "Đổi lý do bán giữa các lần hỏi khác nhau.",
  "Đòi đặt cọc trước khi cho xem giấy tờ.",
  "Nói phải giao dịch cực gấp nhưng không giải thích hậu quả nếu trễ.",
];

/**
 * Việc đối chiếu trực tiếp — cố ý giữ rất ngắn, rồi bàn giao sang Legal Quiz.
 * Không lặp lại toàn bộ checklist pháp lý ở đây.
 */
export const PHYSICAL_CHECKS: readonly string[] = [
  "Đối chiếu giấy tờ gốc của tài sản.",
  "Kiểm tra người giao dịch có khớp giấy tờ hay có giấy uỷ quyền không.",
  "Kiểm tra tình trạng thế chấp / giải chấp tại cơ quan đăng ký.",
];

export const LEGAL_HANDOFF_TEXT =
  "Bước tiếp theo nên là kiểm tra pháp lý trước khi đặt cọc. CheckBDS có công cụ riêng cho việc đó.";
export const LEGAL_HANDOFF_CTA = "Kiểm tra pháp lý trước cọc";
export const LEGAL_HANDOFF_HREF = "/tools/kiem-tra-phap-ly-truoc-coc";

export const GRADER_HANDOFF_TEXT =
  "Muốn xem nhanh mức đáng gọi của tin này thì dùng công cụ chấm điểm tin đăng.";
export const GRADER_HANDOFF_CTA = "Chấm điểm tin đăng";
export const GRADER_HANDOFF_HREF = "/tools/cham-diem-tin-dang";

export const OWNER_ASK =
  "Người giao dịch có phải người đứng tên sổ? Nếu không, có giấy uỷ quyền không?";

/** Ghi chú khi có ngữ cảnh kèm theo (ví dụ điểm ngộp từ lần chấm trước). */
export function contextNote(isNgop?: number | null, dealType?: string | null): string | null {
  const parts: string[] = [];
  if (typeof isNgop === "number" && Number.isFinite(isNgop)) {
    parts.push(`mức ngộp ${isNgop}/100`);
  }
  if (typeof dealType === "string" && dealType.length > 0) {
    parts.push(`phân loại kèo "${dealType}"`);
  }
  if (parts.length === 0) return null;
  return `Lần chấm trước ghi nhận ${parts.join(", ")} — đây là đánh giá của model, không phải xác minh lý do bán.`;
}

// ------------------------------------------------------------------- guard

/**
 * Cụm từ KHÔNG được xuất hiện trong bất kỳ output nào do tool này sinh ra, ở
 * BẤT KỲ dạng nào. Bao gồm mọi cách biến "câu chữ bán gấp" thành kết luận về
 * con người, về giá, hay về chất lượng đầu tư.
 */
export const FORBIDDEN_URGENCY_CLAIMS = [
  "chủ đang kẹt tiền",
  "người bán thật sự ngộp",
  "chắc chắn bán gấp",
  "cắt lỗ thật",
  "đã xác minh",
  "người bán cần tiền",
  "bán gấp thật",
  "bán gấp giả",
  "xác suất",
  "khả năng",
  "đảm bảo sinh lời",
  "lừa đảo",
  "scam",
] as const;

/**
 * Cụm chỉ được xuất hiện khi đang bị PHỦ ĐỊNH.
 *
 * Cần tầng này vì câu cảnh báo trung thực bắt buộc phải NÊU TÊN điều nó phủ
 * nhận: "Bán gấp không có nghĩa là giá tốt hay deal hời." Câu đó chứa "deal hời"
 * nhưng đang bác bỏ nó — chính là cách nói đúng mà tool phải dùng. Cấm tuyệt đối
 * sẽ buộc phải bỏ câu cảnh báo, tức là làm tool kém trung thực hơn.
 */
export const NEGATION_ONLY_CLAIMS = [
  "deal hời",
  "giá hời",
  "kèo ngon",
  "kèo thơm",
  "giá dưới thị trường",
] as const;

export const NEGATION_MARKERS = ["không", "chưa", "chẳng", "không phải", "miễn"] as const;
