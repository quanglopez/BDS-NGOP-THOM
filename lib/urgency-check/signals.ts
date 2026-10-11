// Urgency Verification Checklist (PHASE 6) — danh mục dấu hiệu "bán gấp" trong tin.
//
// Nguyên tắc:
// - Đây là phân tích CÂU CHỮ, không xác minh lý do bán hay tình trạng tài chính.
//   "Tin dùng ngôn ngữ bán gấp" KHÁC "người bán đang kẹt tiền thật".
// - KHÔNG dùng lại scoring ngộp cũ (lib/scoring.ts NGOP_KEYWORDS): bản đó so khớp
//   substring thô, không có phủ định, nên "không bán gấp" vẫn tính là bán gấp.
//   Phase 6 có catalog riêng, đi qua engine phủ định của Phase 4.
// - Catalog bảo thủ: thà bỏ sót (ra "chưa có đủ dữ liệu") hơn là nhận nhầm.
//
// Mức độ:
//   strong = một mình đã đủ để kết luận verify_soon
//   medium = cần >= 2 dấu hiệu độc lập
//   weak   = KHÔNG BAO GIỜ quyết định, và KHÔNG hiện làm bằng chứng
//            (quảng cáo bán hàng, không phải tín hiệu bán gấp)

export type UrgencyTier = "strong" | "medium" | "weak";

/** Mức kết luận. Chỉ hai mức — không có thang điểm, không có xác suất. */
export type UrgencyLevel = "verify_soon" | "insufficient";

/**
 * Nhóm ngữ nghĩa, dùng để sinh câu hỏi có điều kiện mà không trùng lặp.
 *
 * Định nghĩa ở file này (không phải wording.ts) để `wording.ts` và `classify.ts`
 * chỉ cùng import TYPE từ một nguồn, tránh vòng import runtime giữa hai file kia.
 */
export type UrgencyTopic =
  | "distress_sale"
  | "bank"
  | "loss"
  | "price_cut"
  | "transfer"
  | "time_pressure";

export interface UrgencySignalDefinition {
  /** ID ổn định để test và để UI không phụ thuộc câu chữ. */
  id: string;
  tier: UrgencyTier;
  topic: UrgencyTopic;
  /** Các cụm tìm trong bản đã chuẩn hoá (bỏ dấu, lowercase). */
  patterns: readonly string[];
  /**
   * Cụm mà nếu đứng NGAY TRƯỚC cụm khớp thì không tính (đã chuẩn hoá).
   * Chặn cụm lồng nhau gây nhận nhầm.
   */
  excludeIfPrecededBy?: readonly string[];
  /** Nhãn ngắn hiển thị cho dấu hiệu. */
  label: string;
  /** Cụm này nghĩa là gì — mô tả CÂU CHỮ, không phán người bán. */
  reason: string;
}

// ------------------------------------------------------------------ STRONG

export const STRONG_SIGNALS: readonly UrgencySignalDefinition[] = [
  {
    id: "urgent_sell_phrase",
    tier: "strong",
    topic: "distress_sale",
    patterns: ["bán gấp", "cần bán gấp", "cần gấp", "bán nhanh gấp", "cần bán nhanh"],
    label: "Tin dùng cụm chỉ việc bán gấp",
    reason: "Cụm từ này mô tả mong muốn bán nhanh, nhưng không nói vì sao và không có mốc thời gian.",
  },
  {
    id: "needs_money_urgent",
    tier: "strong",
    topic: "distress_sale",
    patterns: ["cần tiền gấp", "kẹt tiền", "cần tiền mặt gấp"],
    label: "Tin nói đang cần tiền gấp",
    reason: "Đây là lời tự khai về tình hình tài chính của người viết, không phải thông tin đã kiểm chứng.",
  },
  {
    id: "cut_loss",
    tier: "strong",
    topic: "loss",
    patterns: ["cắt lỗ", "bán lỗ", "bán dưới giá mua"],
    label: "Tin nói đang cắt lỗ",
    reason: "Cụm này nói về giá so với giá mua trước đó, nhưng không kèm bằng chứng nào trong tin.",
  },
  // OMP S-2: "ngộp" trần bắt nhầm "ngộp nước sau mưa" — chỉ nhận khi
  // đi kèm ngữ cảnh tài chính.
  {
    id: "ngop",
    tier: "strong",
    topic: "distress_sale",
    patterns: ["ngộp ngân hàng", "ngộp bank", "ngộp nợ", "ngộp tài chính"],
    excludeIfPrecededBy: ["khong bi", "chua bi", "khong tung bi", "chua tung bi"],
    label: "Tin dùng từ \"ngộp\" kèm ngữ cảnh tài chính",
    reason:
      "Đây là cách nói trong nghề về áp lực tài chính, không phải thông tin đã kiểm chứng về tình trạng của người bán.",
  },
  // "bị" KHÔNG phải từ đệm của engine phủ định Phase 4, nên các cụm mở đầu bằng
  // "ngân hàng/bank/tài sản" phải tự chặn tiền tố phủ định ở tầng định nghĩa
  // (excludeIfPrecededBy, dạng ĐÃ CHUẨN HOÁ — precededByAny so trên bản bỏ dấu).
  {
    id: "bank_liquidation",
    tier: "strong",
    topic: "bank",
    patterns: ["ngân hàng thanh lý", "bank thanh lý", "tài sản thanh lý ngân hàng"],
    excludeIfPrecededBy: ["khong bi", "chua bi", "khong tung bi", "chua tung bi"],
    label: "Tin nhắc tới ngân hàng thanh lý tài sản",
    reason:
      "Cụm này nói tới việc ngân hàng thanh lý tài sản, nhưng tin không kèm văn bản hay dư nợ để đối chiếu.",
  },
  // OMP B-1: "Không bị ngân hàng siết nợ" — từ nội dung "ngân hàng" đứng giữa
  // từ phủ định và cụm nên engine phủ định không với tới. Liệt kê họ tiền tố
  // phủ định {không, chưa} × {từng} × {bị} × {ngân hàng, bank}.
  {
    id: "bank_foreclosure",
    tier: "strong",
    topic: "bank",
    patterns: ["siết nợ"],
    excludeIfPrecededBy: [
      "khong bi",
      "chua bi",
      "khong tung bi",
      "chua tung bi",
      "khong bi ngan hang",
      "chua bi ngan hang",
      "khong bi bank",
      "chua bi bank",
      "khong tung bi ngan hang",
      "chua tung bi ngan hang",
      "khong tung bi bank",
      "chua tung bi bank",
    ],
    label: "Tin nhắc tới việc siết nợ",
    reason: "Cụm này nói tới việc siết nợ, nhưng tin không nêu bên siết hay dư nợ bao nhiêu để đối chiếu.",
  },
  // OMP B-2: "phát mãi" trần bắt nhầm "phát mãi quà tặng kèm" — chỉ nhận khi
  // cụm gắn với ngân hàng hoặc tài sản.
  {
    id: "property_auction",
    tier: "strong",
    topic: "bank",
    patterns: ["ngân hàng phát mãi", "bank phát mãi", "tài sản bị phát mãi"],
    excludeIfPrecededBy: ["khong bi", "chua bi", "khong tung bi", "chua tung bi"],
    label: "Tin nhắc tới việc tài sản bị phát mãi",
    reason:
      "Cụm này nói tới việc tài sản bị phát mãi, nhưng tin không kèm thông tin đấu giá hay dư nợ để đối chiếu.",
  },
  // OMP S-1: "đã giải chấp xong" là trạng thái ĐÃ HOÀN TẤT, không phải nhu cầu
  // còn đang có — chỉ nhận cụm nói nhu cầu phải giải chấp.
  {
    id: "active_release",
    tier: "strong",
    topic: "bank",
    patterns: ["cần giải chấp", "bán để giải chấp", "bán gấp để giải chấp", "cần bán để giải chấp"],
    label: "Tin nói cần giải chấp khoản vay",
    reason: "Cụm này nói tới việc cần giải chấp, nhưng tin không kèm tài liệu để đối chiếu.",
  },
];

// ------------------------------------------------------------------ MEDIUM

export const MEDIUM_SIGNALS: readonly UrgencySignalDefinition[] = [
  {
    id: "needs_money",
    tier: "medium",
    topic: "distress_sale",
    patterns: ["cần tiền"],
    label: "Tin nói cần tiền",
    reason: "Lý do tài chính được nêu ngắn, không rõ mức độ hay thời hạn.",
  },
  {
    id: "price_reduced",
    tier: "medium",
    topic: "price_cut",
    patterns: ["giảm giá", "giảm sâu", "hạ giá", "giảm mạnh", "đã giảm"],
    label: "Tin nói đã giảm giá",
    reason: "Có nhắc việc giảm giá nhưng không nêu đã giảm từ mức nào và vì sao.",
  },
  {
    id: "sell_fast",
    tier: "medium",
    topic: "time_pressure",
    patterns: ["bán nhanh", "bán trong tháng", "bán trong tuần", "cần bán trong"],
    label: "Tin nêu mong muốn bán nhanh",
    reason: "Có yếu tố thời gian nhưng chưa nói vì sao phải nhanh.",
  },
  {
    id: "transfer_urgent",
    tier: "medium",
    topic: "transfer",
    patterns: ["sang gấp", "cần sang", "sang nhượng gấp"],
    label: "Tin nói cần sang lại",
    reason: "Việc sang lại có thể là chuyển nhượng tài sản hoặc sang hợp đồng thuê — tin chưa nói rõ.",
  },
];

// -------------------------------------------------------------------- WEAK

/**
 * Quảng cáo bán hàng. KHÔNG BAO GIỜ quyết định và KHÔNG hiện làm bằng chứng —
 * mục đích duy nhất là để test khẳng định chúng bị loại.
 */
export const WEAK_SIGNALS: readonly UrgencySignalDefinition[] = [
  {
    id: "weak_marketing",
    tier: "weak",
    topic: "distress_sale",
    patterns: ["cần bán", "siêu phẩm", "giá sốc", "cực hot", "cơ hội vàng", "cam kết", "sinh lời"],
    label: "Cụm quảng cáo",
    reason: "Đây là ngôn ngữ quảng cáo thông thường, không phải dấu hiệu bán gấp.",
  },
];

export const ALL_URGENCY_SIGNALS: readonly UrgencySignalDefinition[] = [
  ...STRONG_SIGNALS,
  ...MEDIUM_SIGNALS,
  ...WEAK_SIGNALS,
];

/** Chỉ dấu hiệu quyết định mới tham gia tính toán; weak bị loại từ đầu. */
export const DECIDING_SIGNALS: readonly UrgencySignalDefinition[] = [
  ...STRONG_SIGNALS,
  ...MEDIUM_SIGNALS,
];

export const SIGNAL_BY_ID: ReadonlyMap<string, UrgencySignalDefinition> = new Map(
  ALL_URGENCY_SIGNALS.map((s) => [s.id, s]),
);

/** Các nhóm ngữ nghĩa có mặt trong bằng chứng — dùng cho câu hỏi có điều kiện. */
export function topicsIn(defs: readonly UrgencySignalDefinition[]): Set<UrgencyTopic> {
  return new Set(defs.map((d) => d.topic));
}
