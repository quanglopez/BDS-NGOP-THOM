// Legal Quiz (PHASE 2) — chấm rủi ro pháp lý trước khi đặt cọc.
//
// Nguyên tắc:
// - HOÀN TOÀN deterministic. Không AI, không gọi mạng, không consume quota.
// - Đầu vào là câu trả lời của người dùng, không phải kết luận pháp lý.
// - Mọi output phải nói "chưa phát hiện rủi ro từ dữ liệu đã nhập" — KHÔNG được
//   nói "an toàn", "pháp lý sạch", "đủ pháp lý", "có thể mua".

export type LegalQuizAnswers = {
  /** Loại giấy tờ. */
  giayTo:
    | "so_do"
    | "so_hong_rieng"
    | "so_chung"
    | "so_ho"
    | "vi_bang"
    | "giay_tay"
    | "chua_ro";
  hoanCong: "co" | "khong" | "chua_ro";
  quyHoach: "da_kiem_tra" | "chua_kiem_tra" | "khong_biet";
  tranhChap: "khong" | "co" | "chua_ro";
  mucDichSuDung: "phu_hop" | "khong_phu_hop" | "chua_ro";
  soHuu: "mot_chu" | "dong_so_huu" | "chua_ro";
  theChap: "khong" | "co" | "chua_ro";
  banGoc: "ban_goc" | "photo" | "chua_xem";
  nguoiBan: "chinh_chu" | "moi_gioi" | "uy_quyen" | "chua_ro";
  lyDoBan: "binh_thuong" | "ban_gap" | "chua_ro";
  giaBatThuong: "binh_thuong" | "thap_bat_thuong" | "chua_ro";
  nhatQuan: "nhat_quan" | "khong_nhat_quan" | "chua_ro";
};

export const QUESTION_COUNT = 12;

/** Cờ rủi ro. `why` giải thích vì sao, `verify` là cách tự kiểm tra. */
export interface RedFlag {
  id: string;
  title: string;
  why: string;
  verify: string;
  /** Điểm cộng vào risk score. */
  weight: number;
  /**
   * "stop" = dừng lại, không được đặt cọc trước khi xác minh. Bất kỳ 1 cờ stop
   * đơn lẻ cũng đẩy kết quả lên RED — vì kiểu rủi ro này không thể khắc phục
   * bằng việc "kiểm tra thêm", mà phải giải quyết xong mới giao dịch được.
   * "caution" = cần kiểm tra thêm, cộng điểm theo weight.
   */
  severity: "stop" | "caution";
}

export type RiskLevel = "red" | "orange" | "green";

export interface LegalQuizResult {
  /** 0–100. Cao = rủi ro cao. */
  riskScore: number;
  level: RiskLevel;
  /** Nhãn mức, đã được guard wording. */
  levelLabel: string;
  /** Câu tóm tắt đã được guard wording. */
  summary: string;
  flags: RedFlag[];
}

// Wording guard: GREEN không được khẳng định an toàn tuyệt đối.
export const LEVEL_LABEL: Record<RiskLevel, string> = {
  red: "Cần dừng và xác minh trước",
  orange: "Cần kiểm tra thêm",
  green: "Chưa phát hiện dấu hiệu rủi ro từ dữ liệu đã nhập",
};

/**
 * GREEN nhưng vẫn sinh cờ (điểm thấp, chưa tới ngưỡng orange).
 * Không được dùng câu "Chưa phát hiện dấu hiệu rủi ro" khi bên dưới đang
 * hiển thị 1+ cờ — người đọc sẽ thấy mâu thuẫn ngay trên cùng một màn hình.
 */
export const GREEN_WITH_NOTES_LABEL = "Rủi ro thấp, có điểm cần lưu ý";

// Những cụm từ tuyệt đối KHÔNG được xuất hiện trong bất kỳ output nào.
export const FORBIDDEN_CLAIMS = [
  "an toàn",
  "pháp lý sạch",
  "đủ pháp lý",
  "có thể mua",
] as const;

const CHECKLIST = [
  "Xem bản gốc sổ, đối chiếu tên người bán với CCCD.",
  "Tra quy hoạch tại UBND quận/huyện hoặc cổng thông tin quy hoạch địa phương.",
  "Kiểm tra thế chấp/ngăn chặn tại Văn phòng đăng ký đất đai.",
  "Hỏi rõ tình trạng hoàn công nếu có xây dựng thêm.",
  "Yêu cầu văn bản đồng thuận của tất cả đồng sở hữu (nếu có).",
  "Không đặt cọc trước khi xong 5 bước trên.",
];

export function legalChecklist(): string[] {
  return [...CHECKLIST];
}

/**
 * Chấm điểm. Điểm cộng dồn từ các cờ, kẹp trong [0,100].
 * Không có cờ nào -> 0 (green), nhưng wording vẫn là "chưa phát hiện".
 */
export function scoreLegalQuiz(a: LegalQuizAnswers): LegalQuizResult {
  const flags: RedFlag[] = [];
  const add = (f: RedFlag) => flags.push(f);

  // 1. Giấy tờ — yếu tố nặng nhất.
  if (a.giayTo === "vi_bang") {
    add({
      id: "vi_bang",
      title: "Chỉ có vi bằng",
      why: "Vi bằng ghi nhận sự kiện, không xác nhận quyền sở hữu đất đai.",
      verify: "Yêu cầu người bán xuất trình sổ gốc; tra thông tin thửa đất tại Văn phòng đăng ký đất đai.",
      weight: 40,
      severity: "stop",
    });
  } else if (a.giayTo === "giay_tay") {
    add({
      id: "giay_tay",
      title: "Giấy tay",
      why: "Giấy tay không phải giấy chứng nhận hợp pháp; rủi ro tranh chấp rất cao.",
      verify: "Không đặt cọc khi chỉ có giấy tay. Cần sổ hoặc hợp đồng chuyển nhượng công chứng hợp lệ.",
      weight: 45,
      severity: "stop",
    });
  } else if (a.giayTo === "so_ho") {
    add({
      id: "so_ho",
      title: "Sổ hộ (đồng sở hữu hộ gia đình)",
      why: "Sổ cấp cho hộ gia đình cần chữ ký của tất cả thành viên có tên.",
      verify: "Xin văn bản đồng thuận có chữ ký đầy đủ người có tên trên sổ.",
      weight: 20,
      severity: "caution",
    });
  } else if (a.giayTo === "so_chung") {
    add({
      id: "so_chung",
      title: "Sổ chung",
      why: "Sổ chung có nhiều đồng sở hữu; giao dịch cần sự đồng ý của tất cả.",
      verify: "Yêu cầu văn bản đồng thuận hoặc uỷ quyền hợp pháp của mọi đồng sở hữu.",
      weight: 25,
      severity: "caution",
    });
  } else if (a.giayTo === "chua_ro") {
    add({
      id: "chua_ro_giay_to",
      title: "Chưa rõ loại giấy tờ",
      why: "Chưa xác định được giấy tờ thì chưa thể đánh giá quyền sở hữu.",
      verify: "Xem trực tiếp bản gốc giấy tờ trước khi đặt cọc.",
      weight: 25,
      severity: "caution",
    });
  }

  // 2. Hoàn công.
  if (a.hoanCong === "khong") {
    add({
      id: "chua_hoan_cong",
      title: "Chưa hoàn công",
      why: "Công trình chưa hoàn công có thể bị xử phạt và khó sang tên.",
      verify: "Yêu cầu giấy phép xây dựng và hồ sơ hoàn công; đối chiếu hiện trạng với sổ.",
      weight: 18,
      severity: "caution",
    });
  } else if (a.hoanCong === "chua_ro") {
    add({
      id: "chua_ro_hoan_cong",
      title: "Chưa rõ tình trạng hoàn công",
      why: "Không biết đã hoàn công hay chưa nên chưa loại trừ được rủi ro xây dựng.",
      verify: "Hỏi trực tiếp và đối chiếu hồ sơ hoàn công tại cơ quan quản lý địa phương.",
      weight: 10,
      severity: "caution",
    });
  }

  // 3. Quy hoạch.
  if (a.quyHoach === "chua_kiem_tra" || a.quyHoach === "khong_biet") {
    add({
      id: "chua_kiem_tra_quy_hoach",
      title: "Chưa kiểm tra quy hoạch",
      why: "Đất vướng quy hoạch có thể bị thu hồi hoặc không được cấp phép xây dựng.",
      verify: "Tra thông tin quy hoạch tại UBND quận/huyện hoặc cổng thông tin quy hoạch địa phương.",
      weight: a.quyHoach === "khong_biet" ? 15 : 12,
      severity: "caution",
    });
  }

  // 4. Tranh chấp.
  if (a.tranhChap === "co") {
    add({
      id: "tranh_chap",
      title: "Đang có tranh chấp",
      why: "Đất đang có tranh chấp là dấu hiệu rủi ro cao; cần giải quyết và xác minh tình trạng trước khi đặt cọc.",
      verify: "Yêu cầu văn bản giải quyết tranh chấp; tra thông tin ngăn chặn tại cơ quan đăng ký đất đai.",
      weight: 35,
      severity: "stop",
    });
  } else if (a.tranhChap === "chua_ro") {
    add({
      id: "chua_ro_tranh_chap",
      title: "Chưa rõ có tranh chấp hay không",
      why: "Chưa xác minh được tranh chấp, rủi ro pháp lý vẫn còn.",
      verify: "Hỏi uỷ ban phường/xã và tra thông tin thửa đất trước khi cọc.",
      weight: 12,
      severity: "caution",
    });
  }

  // 5. Mục đích sử dụng đất.
  if (a.mucDichSuDung === "khong_phu_hop") {
    add({
      id: "muc_dich_khong_phu_hop",
      title: "Mục đích sử dụng đất không phù hợp",
      why: "Mua đất nông nghiệp để xây nhà ở cần chuyển mục đích, tốn chi phí và có thể không được duyệt.",
      verify: "Đối chiếu mục đích sử dụng trên sổ với nhu cầu thực tế; hỏi cơ quan đăng ký đất đai.",
      weight: 22,
      severity: "caution",
    });
  } else if (a.mucDichSuDung === "chua_ro") {
    add({
      id: "chua_ro_muc_dich",
      title: "Chưa rõ mục đích sử dụng đất",
      why: "Chưa biết mục đích sử dụng nên chưa đánh giá được rủi ro chuyển đổi.",
      verify: "Đọc phần mục đích sử dụng trên sổ hoặc tra thông tin thửa đất.",
      weight: 10,
      severity: "caution",
    });
  }

  // 6. Đồng sở hữu.
  if (a.soHuu === "dong_so_huu") {
    add({
      id: "dong_so_huu",
      title: "Đồng sở hữu",
      why: "Giao dịch cần tất cả đồng sở hữu ký; thiếu một chữ ký là giao dịch vô hiệu.",
      verify: "Yêu cầu văn bản đồng thuận hoặc uỷ quyền hợp pháp của mọi đồng sở hữu.",
      weight: 20,
      severity: "caution",
    });
  } else if (a.soHuu === "chua_ro") {
    add({
      id: "chua_ro_so_huu",
      title: "Chưa rõ số lượng chủ sở hữu",
      why: "Không biết có đồng sở hữu hay không nên chưa chắc giao dịch hợp lệ.",
      verify: "Đối chiếu tên trên sổ và yêu cầu người bán xác nhận bằng văn bản.",
      weight: 10,
      severity: "caution",
    });
  }

  // 7. Thế chấp.
  if (a.theChap === "co") {
    add({
      id: "the_chap",
      title: "Đang thế chấp",
      why: "Đất đang thế chấp không thể sang tên cho đến khi giải chấp.",
      verify: "Yêu cầu văn bản giải chấp của ngân hàng; tra thông tin tại cơ quan đăng ký đất đai.",
      weight: 30,
      severity: "stop",
    });
  } else if (a.theChap === "chua_ro") {
    add({
      id: "chua_ro_the_chap",
      title: "Chưa rõ có thế chấp hay không",
      why: "Chưa xác minh thế chấp, có thể phát sinh nghĩa vụ ngân hàng.",
      verify: "Tra thông tin thế chấp/ngăn chặn tại Văn phòng đăng ký đất đai.",
      weight: 12,
      severity: "caution",
    });
  }

  // 8. Bản gốc.
  if (a.banGoc === "photo") {
    add({
      id: "chi_photo",
      title: "Chỉ xem bản photo",
      why: "Bản photo có thể bị chỉnh sửa; không đủ để xác minh sổ thật.",
      verify: "Xem bản gốc, đối chiếu mã QR/số seri và tra thông tin thửa đất.",
      weight: 20,
      severity: "caution",
    });
  } else if (a.banGoc === "chua_xem") {
    add({
      id: "chua_xem_giay_to",
      title: "Chưa xem giấy tờ",
      why: "Chưa xem giấy tờ thì mọi đánh giá khác đều chưa có cơ sở.",
      verify: "Xem bản gốc giấy tờ trước khi đặt cọc.",
      weight: 18,
      severity: "caution",
    });
  }

  // 9. Người bán.
  if (a.nguoiBan === "uy_quyen") {
    add({
      id: "uy_quyen",
      title: "Giao dịch qua người được uỷ quyền",
      why: "Uỷ quyền giả hoặc hết hạn là rủi ro phổ biến.",
      verify: "Kiểm tra hợp đồng uỷ quyền công chứng còn hiệu lực và phạm vi uỷ quyền.",
      weight: 18,
      severity: "caution",
    });
  } else if (a.nguoiBan === "chua_ro") {
    add({
      id: "chua_ro_nguoi_ban",
      title: "Chưa rõ người bán là ai",
      why: "Chưa biết người bán có đứng tên tài sản hay không.",
      verify: "Đối chiếu CCCD người bán với tên trên sổ.",
      weight: 12,
      severity: "caution",
    });
  }

  // 10. Lý do bán gấp + giá thấp bất thường: cặp tín hiệu lừa đảo.
  if (a.lyDoBan === "ban_gap" && a.giaBatThuong === "thap_bat_thuong") {
    add({
      id: "ban_gap_gia_thap",
      title: "Vừa bán gấp vừa rẻ bất thường",
      why: "Giá thấp kèm lý do gấp là mẫu số chung của tin lừa đảo và giấy tờ giả.",
      verify: "Đối chiếu giá với các tin cùng khu vực; không chuyển tiền khi chưa xem sổ gốc.",
      weight: 25,
      severity: "caution",
    });
  } else if (a.giaBatThuong === "thap_bat_thuong") {
    add({
      id: "gia_thap_bat_thuong",
      title: "Giá thấp bất thường",
      why: "Giá lệch xa thị trường thường đi kèm vướng mắc pháp lý hoặc tin giả.",
      verify: "So sánh giá với ít nhất 3 tin tương đương cùng khu vực trước khi cọc.",
      weight: 12,
      severity: "caution",
    });
  }

  // 11. Thông tin không nhất quán.
  if (a.nhatQuan === "khong_nhat_quan") {
    add({
      id: "khong_nhat_quan",
      title: "Thông tin người bán/giấy tờ không nhất quán",
      why: "Thông tin mâu thuẫn là dấu hiệu giấy tờ hoặc danh tính không đáng tin.",
      verify: "Đối chiếu lại tên, số CCCD, địa chỉ thửa đất trên mọi giấy tờ.",
      weight: 25,
      severity: "caution",
    });
  } else if (a.nhatQuan === "chua_ro") {
    add({
      id: "chua_ro_nhat_quan",
      title: "Chưa đối chiếu tính nhất quán",
      why: "Chưa so sánh thông tin nên chưa loại được sai lệch.",
      verify: "Đối chiếu tên, CCCD và địa chỉ thửa đất trên toàn bộ giấy tờ.",
      weight: 8,
      severity: "caution",
    });
  }

  const raw = flags.reduce((sum, f) => sum + f.weight, 0);
  const riskScore = Math.max(0, Math.min(100, raw));

  // Một cờ "stop" là đủ để thành RED, bất kể tổng điểm (ví dụ giấy tay 45 điểm
  // vẫn phải dừng, không thể chỉ "kiểm tra thêm").
  const hasStop = flags.some((f) => f.severity === "stop");
  const level: RiskLevel = hasStop || riskScore >= 50 ? "red" : riskScore >= 20 ? "orange" : "green";

  return {
    riskScore,
    level,
    // Nhãn phải khớp với số cờ thực tế: green + còn cờ thì KHÔNG được nói
    // "chưa phát hiện dấu hiệu rủi ro" trong khi bên dưới liệt kê cờ.
    levelLabel: levelLabelFor(level, flags.length),
    summary: summaryFor(level, flags.length),
    flags,
  };
}

/** Nhãn mức. Tách riêng để test được mà không cần dựng cả quiz. */
export function levelLabelFor(level: RiskLevel, flagCount: number): string {
  if (level === "green" && flagCount > 0) return GREEN_WITH_NOTES_LABEL;
  return LEVEL_LABEL[level];
}

/** Câu tóm tắt. Guard: không bao giờ nói "an toàn". */
function summaryFor(level: RiskLevel, flagCount: number): string {
  if (level === "red") {
    return `Phát hiện ${flagCount} dấu hiệu rủi ro. Cần dừng lại và xác minh trước khi đặt cọc.`;
  }
  if (level === "orange") {
    return `Có ${flagCount} điểm cần kiểm tra thêm trước khi đặt cọc.`;
  }
  if (flagCount > 0) {
    // green + có cờ: dùng số thật, không dùng câu "chưa phát hiện".
    return flagCount === 1
      ? "Có 1 điểm cần lưu ý trước khi đặt cọc."
      : `Có ${flagCount} điểm cần lưu ý trước khi đặt cọc.`;
  }
  return "Kết quả này chưa cho thấy điểm cần cảnh báo từ thông tin bạn cung cấp. Vẫn cần kiểm tra hồ sơ và quy hoạch thực tế.";
}
