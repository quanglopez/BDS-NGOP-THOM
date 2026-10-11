// Owner/Broker signal tool (PHASE 4) — toàn bộ câu chữ hiển thị + guard.
//
// Tập trung ở một chỗ để test khoá được: mọi chuỗi người dùng đọc đều đi qua
// đây, nên chỉ cần quét module này là biết tool có vượt ranh giới hay không.
//
// Ranh giới quan trọng nhất: tool phân tích DẤU HIỆU TRONG CÂU CHỮ, không kết
// luận DANH TÍNH. Vì vậy nhãn kết quả nói về "tin", không nói về "người".

export type Classification = "broker_like" | "owner_like" | "insufficient";

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  broker_like: "CÓ NHIỀU DẤU HIỆU GIỐNG TIN MÔI GIỚI",
  owner_like: "CÓ MỘT SỐ DẤU HIỆU GIỐNG TIN NGƯỜI BÁN TRỰC TIẾP",
  insufficient: "CHƯA ĐỦ DỮ LIỆU",
};

/** Mức độ dấu hiệu. CHỈ dùng chữ — không phần trăm, không xác suất. */
export type EvidenceLevel = "many" | "some" | "insufficient";

export const EVIDENCE_LEVEL_LABEL: Record<EvidenceLevel, string> = {
  many: "KHÁ NHIỀU DẤU HIỆU",
  some: "MỘT VÀI DẤU HIỆU",
  insufficient: "CHƯA ĐỦ DỮ LIỆU",
};

/**
 * Diễn giải mức độ. Nói rõ "trong nội dung tin" — không nói về con người.
 * Không có câu nào khẳng định người đăng là ai.
 */
export const LEVEL_EXPLANATION: Record<EvidenceLevel, string> = {
  many: "Khá nhiều dấu hiệu trong nội dung tin giống cách tin môi giới thường được viết.",
  some: "Có một vài dấu hiệu trong nội dung tin giống cách người bán trực tiếp thường viết.",
  insufficient:
    "Chưa đủ dấu hiệu rõ ràng trong nội dung tin để nghiêng về một hướng nào. Đây là kết quả thường gặp và không có nghĩa là tin đáng nghi.",
};

// ---------------------------------------------------------------- limitation

/**
 * Câu giới hạn năng lực — BẮT BUỘC hiển thị ngay trên kết quả, không chỉ ở footer.
 */
export const LIMITATION_PRIMARY =
  "CheckBDS chỉ phân tích dấu hiệu trong nội dung tin đăng, không xác minh danh tính người bán.";

export const LIMITATION_SELF_CLAIM =
  "Người đăng có thể tự ghi \"chính chủ\", vì vậy cụm từ này không đủ để xác minh ai là người đứng tên tài sản.";

export const LIMITATION_COPY_REASON =
  "Nội dung tin có thể được sao chép hoặc viết lại, nên công cụ này không thể phát hiện trường hợp một bên bán hộ dùng lại câu chữ của người bán trực tiếp.";

export const LIMITATION_LIST = [
  LIMITATION_PRIMARY,
  LIMITATION_SELF_CLAIM,
  LIMITATION_COPY_REASON,
] as const;

// ---------------------------------------------------------------- questions

/**
 * Câu hỏi để người dùng TỰ xác minh khi gặp người bán.
 * Đây là gợi ý đi hỏi, không phải khẳng định công cụ đã phân loại đúng.
 */
export const VERIFY_QUESTIONS: readonly string[] = [
  "Anh/chị là người đứng tên trên sổ hay đang hỗ trợ chủ bán?",
  "Sổ hiện đứng tên ai, và có thể cho xem ảnh trang thông tin sổ trước khi đi xem không?",
  "Có thể gặp trực tiếp người đứng tên sổ không?",
  "Căn này còn bán đúng giá trong tin không, và giá còn thương lượng được bao nhiêu?",
  "Ngoài căn này anh/chị còn căn nào khác đang bán không?",
];

// ---------------------------------------------------------------- headings

export const EVIDENCE_HEADING_BROKER = "Dấu hiệu giống tin môi giới";
export const EVIDENCE_HEADING_OWNER = "Dấu hiệu thiên về người bán trực tiếp";
export const EVIDENCE_HEADING_CONFLICT = "Hai hướng dấu hiệu cùng xuất hiện";
export const EVIDENCE_HEADING_EMPTY = "Không tìm thấy dấu hiệu rõ ràng";

export const EVIDENCE_EMPTY_NOTE =
  "Không tìm thấy cụm từ đặc trưng nào. Không có dấu hiệu KHÔNG có nghĩa là tin đã được xác minh.";

export const CONFLICT_NOTE =
  "Nội dung tin có cả dấu hiệu của bên bán hàng lẫn dấu hiệu của người bán trực tiếp, nên CheckBDS không nghiêng về bên nào.";

export const QUESTIONS_HEADING = "Nên hỏi gì trước khi đi xem?";

export const QUESTIONS_NOTE =
  "Các câu hỏi dưới đây giúp bạn tự xác minh khi gặp người bán. Chúng không phải kết luận về người đăng.";

// ---------------------------------------------------------------- guard

/**
 * Cụm từ TUYỆT ĐỐI không được xuất hiện trong output, ở bất kỳ dạng nào.
 * Đây là các câu biến dấu hiệu thành kết luận danh tính, hoặc cam kết độ chính xác.
 */
export const FORBIDDEN_OWNER_CLAIMS = [
  "đã xác minh",
  "chính chủ 100%",
  "100% chính chủ",
  "môi giới chắc chắn",
  "chắc chắn là môi giới",
  "chắc chắn là chính chủ",
  "cam kết",
  "đảm bảo",
  "bảo đảm",
  "độ chính xác",
  "xác suất",
  "phần trăm",
] as const;

/**
 * Cụm từ chỉ được xuất hiện khi đang bị PHỦ ĐỊNH.
 *
 * "xác minh danh tính" nằm ở đây vì câu giới hạn bắt buộc —
 * "CheckBDS chỉ phân tích dấu hiệu trong nội dung tin đăng, không xác minh
 * danh tính người bán." — CHỨA cụm này, nhưng đang phủ nhận năng lực. Đó
 * chính là cách nói trung thực mà tool phải dùng, nên không thể cấm tuyệt đối;
 * chỉ cấm khi dùng như lời hứa hẹn.
 */
export const NEGATION_ONLY_CLAIMS = ["xác minh danh tính"] as const;

/** Từ phủ định dùng để nhận biết câu nói thật. */
export const NEGATION_MARKERS = ["không", "chưa", "chẳng", "không phải", "miễn"] as const;

/**
 * Nhãn được phép hiển thị nhưng luôn phải đi kèm cảnh báo rằng đây là phân
 * tích câu chữ. Test kiểm tra cặp "nhãn + limitation" luôn cùng tồn tại.
 */
export const LIMITATION_REQUIRED_WITH_RESULT = true;
