// Owner/Broker signal tool (PHASE 4) — danh mục dấu hiệu trong NỘI DUNG TIN.
//
// Nguyên tắc xuyên suốt:
// - Đây là phân tích CÂU CHỮ, không phải xác minh danh tính. Mỗi dấu hiệu mô tả
//   "nội dung tin cho thấy điều gì", không phải "người đăng là ai".
// - Đại từ nhân xưng ("em", "chúng tôi") KHÔNG BAO GIỜ tự quyết định kết quả.
// - Lời tự khai ("chính chủ", "miễn trung gian") là dấu hiệu YẾU: người đăng tự
//   ghi được, môi giới cũng ghi được. Không bao giờ đủ để kết luận.
//
// Mức độ:
//   strong = nội dung mô tả HOẠT ĐỘNG mà chỉ bên bán hàng chuyên nghiệp mới có
//            (nhận ký gửi, có kho hàng, là công ty/sàn). Một cái là đủ.
//   medium = nội dung mô tả quan hệ với tài sản / dịch vụ bán hàng rõ ràng.
//            Cần >= 2 cái độc lập.
//   weak   = đại từ, CTA bán hàng, lời tự khai. KHÔNG BAO GIỜ quyết định.

export type SignalStrength = "strong" | "medium" | "weak";

export type SignalSide = "broker" | "owner";

export interface SignalDefinition {
  /** ID ổn định để test và để UI không phụ thuộc câu chữ. */
  id: string;
  side: SignalSide;
  strength: SignalStrength;
  /** Các cụm được tìm trong bản chuẩn hoá (đã bỏ dấu, lowercase). */
  patterns: readonly string[];
  /** Biến thể viết liền không dấu, chỉ cho vài cụm đặc trưng. */
  glued?: readonly string[];
  /**
   * Cụm mà nếu đứng NGAY TRƯỚC cụm khớp thì KHÔNG tính là dấu hiệu.
   *
   * Phải viết ở dạng ĐÃ CHUẨN HOÁ (bỏ dấu, lowercase), vì so khớp chạy trên bản
   * chuẩn hoá. Trộn literal có dấu với không dấu là lỗi đã gặp: exclusion khai
   * "chúng" sẽ không bao giờ khớp vì văn bản đã thành "chung".
   *
   * Cho phép nhiều token: "Công ty tôi cần bán" chứa "tôi cần bán" nhưng từ ngay
   * trước là "ty", nên phải khai cả "cong ty" chứ không chỉ "cong".
   */
  excludeIfPrecededBy?: readonly string[];
  /** Câu chữ ngắn hiển thị làm nhãn dấu hiệu. */
  label: string;
  /** Cụm này gợi ý điều gì — mô tả NỘI DUNG, không phán người. */
  means: string;
}

// ---------------------------------------------------------------- BROKER

export const BROKER_SIGNALS: readonly SignalDefinition[] = [
  // ---- STRONG: hoạt động bán hàng chuyên nghiệp ----
  //
  // Nguyên tắc chọn pattern STRONG: phải mô tả ROLE/ACTIVITY của người viết,
  // KHÔNG phải địa danh, tiện ích, hay câu vô tình chứa substring.
  // Ưu tiên độ chính xác: bỏ sót -> "chưa đủ dữ liệu" (chấp nhận được);
  // nhận nhầm -> kết luận sai (không chấp nhận được).
  {
    id: "broker_receive_consignment",
    side: "broker",
    strength: "strong",
    patterns: ["nhận ký gửi", "ky gui nha", "ky gui dat", "nhận bán hộ"],
    label: "Nội dung mô tả hoạt động nhận ký gửi",
    means: "Cụm này mô tả một hoạt động nhận bán hộ, không phải lời rao bán tài sản của chính người viết.",
  },
  {
    id: "broker_customer_sent",
    side: "broker",
    strength: "strong",
    // KHÔNG dùng trần "khách gửi": "chỗ khách gửi xe miễn phí" là tiện ích toà
    // nhà, không phải hoạt động bán hàng. Bắt buộc phải có ngữ cảnh bán.
    patterns: ["khách gửi bán", "khách gửi nhà", "khách gửi đất", "khách nhờ bán", "chủ gửi bán"],
    label: "Nội dung nói tài sản do người khác gửi bán",
    means: "Câu chữ cho thấy người viết đang rao bán hộ tài sản của người khác.",
  },
  {
    id: "broker_many_units",
    side: "broker",
    strength: "strong",
    patterns: [
      "còn nhiều căn",
      "nhiều căn cùng",
      "còn nhiều lô",
      "nhiều lô cùng",
      "còn nhiều sản phẩm",
      "danh sách căn",
    ],
    label: "Nội dung cho thấy có nhiều sản phẩm cùng lúc",
    means: "Một người bán tài sản của mình thường chỉ có một tài sản; nhiều sản phẩm cùng lúc là dấu hiệu của bên bán hàng.",
  },
  {
    id: "broker_inventory",
    side: "broker",
    strength: "strong",
    // KHÔNG dùng trần "kho hàng": "nhà có kho hàng phía sau" là mô tả nhà kho
    // gắn với bất động sản, "gần kho hàng logistics" là địa danh. Chỉ nhận khi
    // cụm nói rõ đây là danh mục tin đang bán.
    patterns: [
      "kho hàng nhà đất",
      "kho hàng bất động sản",
      "kho căn",
      "giỏ hàng",
      "quỹ căn",
      "nguồn hàng",
    ],
    label: "Nội dung dùng từ chỉ nguồn hàng",
    means: "Cách gọi tài sản là \"hàng\" cho thấy người viết xem đây là danh mục để bán, không phải tài sản của mình.",
  },
  {
    id: "broker_specialist",
    side: "broker",
    strength: "strong",
    patterns: [
      "chuyên khu vực",
      "chuyên nhà phố",
      "chuyên đất nền",
      "chuyên căn hộ",
      "chuyên nhà mặt tiền",
      "chuyên mua bán",
    ],
    label: "Nội dung tự mô tả chuyên môn theo nhóm sản phẩm",
    means: "Tự nhận chuyên một nhóm sản phẩm là cách mô tả của bên làm nghề bán hàng, không phải người bán tài sản của mình.",
  },
  {
    id: "broker_company",
    side: "broker",
    strength: "strong",
    // KHÔNG dùng trần "chi nhánh" / "sàn giao dịch" / "văn phòng giao dịch":
    // "gần chi nhánh ngân hàng", "gần sàn giao dịch chứng khoán", "văn phòng
    // giao dịch ngân hàng" đều là địa danh/tiện ích xung quanh bất động sản.
    // Bắt buộc phải gắn với bất động sản / môi giới.
    patterns: [
      "công ty bất động sản",
      "công ty bds",
      "sàn bất động sản",
      "sàn môi giới",
      "văn phòng bất động sản",
      "phòng kinh doanh bất động sản",
      "đại lý bất động sản",
    ],
    label: "Nội dung nêu tổ chức bất động sản",
    means: "Có tổ chức bất động sản đứng sau lời rao là dấu hiệu của bên bán hàng, không phải giao dịch cá nhân.",
  },

  // ---- MEDIUM: dịch vụ bán hàng rõ ràng ----
  {
    id: "broker_support_service",
    side: "broker",
    strength: "medium",
    patterns: [
      "hỗ trợ mua bán",
      "hỗ trợ tìm nhà",
      "hỗ trợ tìm đất",
      "hỗ trợ vay",
      "hỗ trợ pháp lý",
      "hỗ trợ sang tên",
    ],
    label: "Nội dung mô tả dịch vụ hỗ trợ",
    means: "Nhận hỗ trợ người khác mua bán là mô tả một dịch vụ, không phải bán tài sản của mình.",
  },
  {
    id: "broker_free_service",
    side: "broker",
    strength: "medium",
    patterns: [
      "tư vấn miễn phí",
      "miễn phí xem nhà",
      "miễn phí tham quan",
      "miễn phí tư vấn",
      "xem nhà miễn phí",
    ],
    label: "Nội dung mời dịch vụ miễn phí",
    means: "Mời xem/tư vấn miễn phí là cách tiếp cận khách hàng, thường không phải câu chữ của người bán tài sản của mình.",
  },
  {
    id: "broker_view_more_units",
    side: "broker",
    strength: "medium",
    patterns: [
      "liên hệ để xem nhiều căn",
      "xem thêm nhiều căn",
      "còn nhiều căn khác",
      "nhiều căn khác",
      "tham khảo thêm nhiều căn",
    ],
    label: "Nội dung mời xem thêm căn khác",
    means: "Mời xem thêm căn khác cho thấy có sẵn danh mục để giới thiệu.",
  },
  {
    id: "broker_contact_for_list",
    side: "broker",
    strength: "medium",
    patterns: ["nhận thông tin căn", "gửi danh sách căn", "danh sách nhà", "nhận bảng giá nhiều căn"],
    label: "Nội dung mời nhận danh sách / bảng giá",
    means: "Có sẵn danh sách để gửi là dấu hiệu của bên bán hàng nhiều sản phẩm.",
  },

  // ---- WEAK: không bao giờ quyết định ----
  {
    id: "broker_pronoun",
    side: "broker",
    strength: "weak",
    patterns: ["bên em", "chúng tôi", "bên mình", "team"],
    label: "Cách xưng hô theo nhóm",
    means: "Cách xưng hô này chỉ gợi ý, không đủ để nói gì về người đăng.",
  },
  {
    id: "broker_sales_cta",
    side: "broker",
    strength: "weak",
    patterns: ["gọi ngay", "lh ngay", "liên hệ ngay", "inbox ngay", "alo ngay", "call ngay"],
    label: "Câu kêu gọi liên hệ gấp",
    means: "Kêu gọi liên hệ là cách viết phổ biến ở mọi loại tin, kể cả tin người bán tự đăng.",
  },
];

// ---------------------------------------------------------------- OWNER

export const OWNER_SIGNALS: readonly SignalDefinition[] = [
  // ---- MEDIUM: quan hệ trực tiếp với tài sản ----
  {
    id: "owner_my_house",
    side: "owner",
    strength: "medium",
    patterns: ["nhà tôi", "đất tôi", "tôi cần bán", "tôi muốn bán", "tôi đang ở"],
    // "chúng tôi cần bán" / "bên tôi cần bán" / "công ty tôi cần bán" là chủ thể
    // số nhiều hoặc tổ chức, không phải người bán cá nhân.
    //
    // Cụm khớp là "tôi cần bán", nên phần đứng TRƯỚC nó chỉ là "chúng" /
    // "bên" / "công ty" — không phải "chúng tôi". Vì vậy exclusion phải khai
    // đúng phần thực sự đứng trước, ở dạng ĐÃ CHUẨN HOÁ (bỏ dấu).
    //
    // Cho phép nhiều token vì "Công ty tôi cần bán" có từ ngay trước là "ty",
    // nên một token đơn là không đủ.
    excludeIfPrecededBy: ["chung", "ben", "cong ty"],
    label: "Nội dung nói trực tiếp về tài sản của người viết",
    means: "Câu chữ xưng \"tôi\" gắn với chính tài sản đang rao.",
  },
  {
    id: "owner_living_here",
    side: "owner",
    strength: "medium",
    patterns: ["nhà đang ở", "đang sinh sống", "gia đình đang ở", "nhà tôi đang ở"],
    label: "Nội dung mô tả tài sản đang được sử dụng",
    means: "Mô tả nơi đang ở là thông tin về việc sử dụng tài sản, khác với mô tả hàng để bán.",
  },
  {
    id: "owner_family_sale",
    side: "owner",
    strength: "medium",
    patterns: [
      "gia đình cần bán",
      "gia đình tôi bán",
      "ba mẹ để lại",
      "bố mẹ để lại",
      "ông bà để lại",
      "thừa kế",
      "con cái bán",
    ],
    label: "Nội dung nói tài sản thuộc gia đình / thừa kế",
    means: "Câu chữ gắn tài sản với quan hệ gia đình hoặc thừa kế.",
  },
  {
    id: "owner_moving_reason",
    side: "owner",
    strength: "medium",
    patterns: [
      "bán để chuyển",
      "chuyển chỗ ở",
      "chuyển công tác",
      "về quê",
      "đi nước ngoài",
      "định cư",
      "bán chia tài sản",
    ],
    label: "Nội dung nêu lý do cá nhân",
    means: "Lý do bán gắn với hoàn cảnh sống của người viết.",
  },

  // ---- WEAK: lời tự khai, không bao giờ quyết định ----
  {
    id: "owner_self_claim",
    side: "owner",
    strength: "weak",
    patterns: ["chính chủ"],
    glued: ["chinhchu"],
    label: "Tin tự ghi \"chính chủ\"",
    means:
      "Đây là lời tự khai. Người đăng tự ghi được, và người bán hộ cũng ghi được, nên cụm này không xác minh ai đứng tên tài sản.",
  },
  {
    id: "owner_no_intermediary",
    side: "owner",
    strength: "weak",
    patterns: [
      "miễn trung gian",
      "không tiếp môi giới",
      "không qua môi giới",
      "miễn môi giới",
      "không tiếp trung gian",
      "miễn tiếp môi giới",
    ],
    label: "Tin ghi miễn trung gian",
    means: "Đây là yêu cầu/lời tự khai trong tin, không phải bằng chứng về người đứng tên tài sản.",
  },
  {
    id: "owner_name_on_deed",
    side: "owner",
    strength: "weak",
    patterns: ["đứng tên sổ", "sổ tên tôi", "sổ đứng tên tôi", "tên tôi trên sổ", "sổ chính chủ"],
    label: "Tin tự nói tên trên sổ",
    means: "Đây là lời tự khai trong nội dung tin; chỉ kiểm chứng được khi xem sổ gốc và giấy tờ tùy thân.",
  },
];

export const ALL_SIGNALS: readonly SignalDefinition[] = [...BROKER_SIGNALS, ...OWNER_SIGNALS];

/** Nhóm theo ID để tra cứu nhanh trong test/UI. */
export const SIGNAL_BY_ID: ReadonlyMap<string, SignalDefinition> = new Map(
  ALL_SIGNALS.map((s) => [s.id, s]),
);

export function signalsForSide(side: SignalSide): readonly SignalDefinition[] {
  return side === "broker" ? BROKER_SIGNALS : OWNER_SIGNALS;
}

export function signalStrengthOf(id: string): SignalStrength | null {
  return SIGNAL_BY_ID.get(id)?.strength ?? null;
}
