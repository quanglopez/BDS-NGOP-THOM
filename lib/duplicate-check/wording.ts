// So sánh 2 tin BĐS (PHASE 7) — toàn bộ câu chữ hiển thị + guard.
//
// Tập trung một chỗ để test khoá được: mọi chuỗi người dùng đọc đều đi qua đây.
//
// Ranh giới quan trọng nhất:
//   bằng chứng giống nhau != cùng một tài sản
//   chênh lệch giá         != giá sai
//   cùng số điện thoại     != cùng người bán
// Không có câu nào trong output được nói ngược lại những điều trên.

export type DuplicateLevel = "high" | "medium" | "low";

export const LEVEL_LABEL: Record<DuplicateLevel, string> = {
  high: "NHIỀU DẤU HIỆU GIỐNG NHAU",
  medium: "CÓ MỘT SỐ DẤU HIỆU GIỐNG NHAU",
  low: "CHƯA ĐỦ DỮ LIỆU ĐỂ SO SÁNH",
};

/** Giải thích ngắn cho từng mức. Căn cứ luôn là CÂU CHỮ, không phải thực tế. */
export const LEVEL_EXPLANATION: Record<DuplicateLevel, string> = {
  high:
    "Hai tin giống nhau ở nhiều điểm về câu chữ. Điều này không cho biết đó là cùng một tài sản — hãy đối chiếu theo danh sách câu hỏi bên dưới.",
  medium:
    "Hai tin giống nhau ở một số điểm về câu chữ. Chưa đủ điểm giống để thấy mối liên hệ rõ ràng giữa hai tin.",
  low:
    "Chưa thấy đủ điểm giống nhau rõ ràng giữa hai tin theo nội dung đã dán. Hai tin có thể hoàn toàn khác nhau, hoặc nội dung còn thiếu chi tiết.",
};

/** Banner mâu thuẫn — không phải mức độ giống nhau thứ tư. */
export const BANNER_TEXT = "CÓ THÔNG TIN KHÁC NHAU CẦN ĐỐI CHIẾU";

/** Câu giới hạn năng lực — BẮT BUỘC hiển thị trên trang và trong kết quả. */
export const LIMITATION =
  "CheckBDS chỉ so sánh thông tin xuất hiện trong hai nội dung bạn dán. Kết quả không xác nhận hai tin là cùng một tài sản, không xác minh người đăng và không xác định giá thật của bất động sản.";

export const SHARED_HEADING = "Điểm giống nhau";
export const SHARED_NOTE =
  "Các điểm dưới đây chỉ là câu chữ xuất hiện ở cả hai tin, không phải kết luận hai tin là cùng một tài sản.";
export const SHARED_EMPTY_NOTE = "Không tìm thấy điểm giống nhau rõ ràng theo nội dung đã dán.";

export const DIFFERENCE_HEADING = "Điểm khác nhau cần đối chiếu";
export const DIFFERENCE_NOTE =
  "Các thông tin dưới đây ghi khác nhau giữa hai tin. Sự khác nhau không có nghĩa là tin nào sai — chỉ là cần hỏi thêm.";

export const PRICE_HEADING = "GIÁ NIÊM YẾT TRONG HAI TIN";
export const PRICE_UNAVAILABLE_NOTE =
  "Chưa so sánh được giá niêm yết theo cách ghi trong hai tin.";
export const PRICE_EQUAL_TEXT = "Giá niêm yết trong hai tin bằng nhau (theo cách ghi trong tin).";

export const CHECKLIST_HEADING = "Câu hỏi nên đối chiếu trước khi đặt cọc";

/** 7 câu hỏi cố định — phần sản phẩm chính, luôn hiển thị. */
export const CHECKLIST: readonly string[] = [
  "Hai tin có cùng block/tòa/khu không?",
  "Tầng hoặc vị trí căn/lô là gì?",
  "Diện tích trên giấy tờ là bao nhiêu?",
  "Mã căn/lô/thửa có trùng không?",
  "Giá hiện tại là giá chốt hay giá quảng cáo?",
  "Vì sao hai tin có thông tin giống nhau nhưng giá khác nhau?",
  "Đã đối chiếu trực tiếp giấy tờ và hiện trạng tài sản trước khi đặt cọc chưa?",
];

/** Bàn giao sang công cụ hiện có — chỉ là link, không tích hợp logic. */
export const CROSS_TOOL: readonly { text: string; href: string }[] = [
  { text: "Chấm điểm từng tin", href: "/tools/cham-diem-tin-dang" },
  { text: "Kiểm tra dấu hiệu bán gấp", href: "/tools/kiem-tra-dau-hieu-ban-gap" },
  { text: "Kiểm tra pháp lý trước cọc", href: "/tools/kiem-tra-phap-ly-truoc-coc" },
];

// ------------------------------------------------------------ nhãn bằng chứng

export function projectLabel(name: string): string {
  return `cùng dự án: “${name}”`;
}

export function locationLabel(phrase: string): string {
  return `cùng cụm vị trí: “${phrase}”`;
}

export function formatArea(n: number): string {
  return String(n).replace(".", ",");
}

export function areaLabel(a: number, b: number): string {
  if (a === b) return `cùng diện tích: ${formatArea(a)} m²`;
  return `cùng diện tích: ${formatArea(a)} m² (Tin B ghi ${formatArea(b)} m²)`;
}

export function bedroomsLabel(n: number): string {
  return `cùng ${n} phòng ngủ`;
}

export function spanLabel(quote: string): string {
  return `cùng cụm mô tả: “${quote}”`;
}

// ------------------------------------------------------------ mâu thuẫn

export function provinceDiff(a: string, b: string): string {
  return `Tin A ghi khu vực ${a}, Tin B ghi ${b}.`;
}

export function projectDiff(a: string, b: string): string {
  return `Tin A ghi dự án “${a}”, Tin B ghi dự án “${b}”.`;
}

export function towerDiff(a: string, b: string): string {
  return `Tin A ghi tòa ${a}, Tin B ghi tòa ${b}.`;
}

export function areaDiff(a: number, b: number): string {
  return `Diện tích chênh lệch nhiều: Tin A ghi ${formatArea(a)} m², Tin B ghi ${formatArea(b)} m².`;
}

export function bedroomsDiff(a: number, b: number): string {
  return `Số phòng ngủ khác nhau: Tin A ghi ${a} phòng ngủ, Tin B ghi ${b} phòng ngủ.`;
}

// ------------------------------------------------------------ phần giá

export function priceLine(side: "A" | "B", quote: string): string {
  return `Tin ${side} ghi ${quote}.`;
}

export function priceDiffLine(diff: string): string {
  return `Chênh lệch giá niêm yết: ${diff}.`;
}

export function pricePctLine(pct: string): string {
  return `Tương ứng ${pct}% so với mức trung bình của hai mức giá niêm yết.`;
}

// ------------------------------------------------------------ guard

/**
 * Cụm KHÔNG được xuất hiện trong bất kỳ output nào của tool này, ở BẤT KỲ dạng nào.
 * Bao gồm mọi cách biến "câu chữ giống nhau" thành kết luận về trùng lặp,
 * về người bán, hay về giá đúng/sai.
 */
export const FORBIDDEN_CLAIMS = [
  "% trùng",
  "match 90",
  "độ trùng",
  "chắc chắn",
  "tin giả",
  "giá ảo",
  "kê giá",
  "overpriced",
  "giá thị trường là",
  "tin nào đúng giá",
  "xác minh tin trùng",
  "phát hiện tin giả",
  "xác suất",
  "khả năng",
  "cùng chủ",
  "cùng môi giới",
  "cùng người đăng",
] as const;

/**
 * Cụm chỉ được xuất hiện khi đang bị PHỦ ĐỊNH hoặc được nêu ra để BÁC BO.
 *
 * Cần tầng này vì câu giới hạn năng lực bắt buộc phải NÊU TÊN điều nó phủ nhận:
 * "không xác nhận ... cùng một tài sản", "không xác định giá thật". FAQ cũng nêu
 * "cùng người bán" để trả lời KHÔNG. Cấm tuyệt đối sẽ buộc phải bỏ những câu
 * trung thực nhất của tool.
 */
export const NEGATION_ONLY_CLAIMS = [
  "cùng một tài sản",
  "cùng căn",
  "giá thật",
  "trùng",
  "cùng người bán",
] as const;

/** Dấu phủ định ở dạng thường, dùng soi ngữ cảnh quanh claim. */
export const NEGATION_MARKERS = ["không", "chưa", "chẳng", "chưa thể"] as const;
