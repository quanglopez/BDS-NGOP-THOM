import type {
  AnalysisBreakdown,
  AnalysisResult,
  CheckApiResponse,
  TagColor,
  ActionType,
} from "@/lib/types";

// Từ khóa ngộp: match đúng chuỗi con nên "ngop" bắt cả "ngộp"
const NGOP_KEYWORDS = [
  "bán gấp",
  "ngộp",
  "ngop",
  "ngân hàng",
  "thanh lý",
  "cần tiền",
  "kẹt tiền",
  "bán lỗ",
  "giải chấp",
  "siết nợ",
];

const AREAS = [
  "thùy vân",
  "trần phú",
  "hạ long",
  "bãi sau",
  "bãi trước",
  "bãi dâu",
  "phường 8",
  "phường 11",
  "chí linh",
  "thắng tam",
];

// Chấm điểm local (fallback khi thiếu JEV_API_KEY / AI lỗi)
export function analyzeListing(input: string): AnalysisResult {
  const text = input;
  const n = input.toLowerCase();

  const priceMatch = text.match(/(\d+[\.,]?\d*)\s*tỷ/i);
  const areaMatch = text.match(/(\d+)\s*m2/i);
  const price = priceMatch ? `${priceMatch[1]} tỷ` : "Chưa rõ";
  const area = areaMatch ? `${areaMatch[1]}m²` : "Chưa rõ";

  const foundArea = AREAS.find((a) => n.includes(a)) || "Vũng Tàu";
  const street = foundArea.charAt(0).toUpperCase() + foundArea.slice(1);

  // 1) Điểm ngộp
  const hits = NGOP_KEYWORDS.filter((k) => n.includes(k));
  const hitCount = hits.length;
  const ngop = Math.min(95, 20 + hitCount * 28 + (n.includes("gấp") ? 20 : 0));

  // 2) Điểm tăng giá theo vị trí
  let tangGia = 50;
  if (["thùy vân", "thuy van", "trần phú", "bãi sau", "bãi trước"].some((a) => n.includes(a))) {
    tangGia = 90;
  } else if (["hạ long", "bãi dâu", "chí linh"].some((a) => n.includes(a))) {
    tangGia = 78;
  } else if (n.includes("phường 8") || n.includes("phường 11")) {
    tangGia = 62;
  }

  // 3) Thanh khoản theo loại hình
  let thanhKhoan = 60;
  if (n.includes("mặt tiền") || n.includes("mt")) thanhKhoan = 88;
  else if (n.includes("hẻm xe hơi") || n.includes("oto")) thanhKhoan = 75;
  else if (n.includes("hẻm nhỏ") || n.includes("hẻm 2m") || n.includes("hẻm 1m")) thanhKhoan = 35;

  // 4) Pháp lý theo sổ
  let phapLy = 70;
  if (n.includes("sổ hồng riêng") || n.includes("sổ đỏ") || n.includes("hoàn công")) phapLy = 95;
  else if (n.includes("sổ chung")) phapLy = 55;
  else if (n.includes("giấy tay") || n.includes("vi bằng") || n.includes("không sổ")) phapLy = 25;

  // 5) Chênh lệch giá so với thị trường (số dương = rẻ hơn)
  let diff = 0;
  if (n.includes("rẻ hơn") || n.includes("thấp hơn")) {
    const m = text.match(/rẻ hơn.*?(\d+).*?(tỷ|tr)/i) || text.match(/(\d+)\s*%/);
    if (m) {
      diff = parseInt(m[1]);
      if (diff > 100) diff = 18;
      if (diff < 5) diff = 15;
    } else {
      diff = 18;
    }
  } else if (n.includes("cao hơn thị trường") || n.includes("ngáo giá")) {
    diff = -12;
  } else if (hitCount >= 2) {
    diff = 12 + hitCount * 2;
  }

  const viTriScore = tangGia;
  let overall = Math.round(
    ngop * 0.25 + tangGia * 0.25 + thanhKhoan * 0.15 + phapLy * 0.15 + (50 + diff * 1.5) * 0.2,
  );
  if (n.includes("tranh chấp") || n.includes("quy hoạch treo") || n.includes("ngập")) overall -= 25;
  overall = Math.max(12, Math.min(98, overall));

  // 6) Tag theo điểm
  let tag = "";
  let tagColor: TagColor = "yellow";
  let actionType: ActionType = "ok";
  if (overall >= 80) {
    tag = ngop > 70 ? "KÈO NGỘP NGON" : "TIỀM NĂNG CAO";
    tagColor = "green";
    actionType = "hot";
  } else if (overall >= 50) {
    tag = "CÂN NHẮC ĐƯỢC";
    tagColor = "yellow";
    actionType = "ok";
  } else {
    tag = diff < 0 ? "GIÁ CAO HƠN THỊ TRƯỜNG" : "RỦI RO CAO - NÊN BỎ QUA";
    tagColor = "red";
    actionType = "skip";
  }

  const pricePerM2 = (() => {
    if (price === "Chưa rõ" || area === "Chưa rõ") return "";
    const p = parseFloat(price.replace(",", "."));
    const a = parseInt(area);
    if (!isNaN(p) && !isNaN(a) && a > 0) return `${((p * 1000) / a).toFixed(1)}tr/m²`;
    return "";
  })();

  const breakdown: AnalysisBreakdown = {
    ngop: {
      score: ngop,
      label: ngop > 70 ? "Ngộp thật" : ngop > 40 ? "Nghi ngộp" : "Bình thường",
      detail: hitCount > 0 ? `Từ khóa: ${hits.join(", ")}` : "Không có dấu hiệu bán gấp",
    },
    tangGia: {
      score: tangGia,
      label: tangGia > 85 ? "Tăng mạnh" : tangGia > 70 ? "Tăng khá" : "Tăng chậm",
      detail:
        tangGia > 85
          ? "Gần biển Bãi Sau - du lịch bùng nổ"
          : tangGia > 60
            ? "Khu dân cư ổn định Vũng Tàu"
            : "Khu vực xa trung tâm",
    },
    thanhKhoan: {
      score: thanhKhoan,
      label: thanhKhoan > 80 ? "Dễ bán lại" : thanhKhoan > 60 ? "Trung bình" : "Kén khách",
      detail: n.includes("mặt tiền")
        ? "Mặt tiền - thanh khoản vua"
        : n.includes("hẻm nhỏ")
          ? "Hẻm nhỏ - khó ra hàng"
          : "Hẻm xe hơi - ổn",
    },
    phapLy: {
      score: phapLy,
      label: phapLy > 90 ? "An toàn" : phapLy > 60 ? "Tạm ổn" : "Rủi ro",
      detail:
        phapLy > 90 ? "Sổ hồng riêng, hoàn công đủ" : phapLy < 40 ? "Giấy tay / vi bằng - check kỹ" : "Cần kiểm tra quy hoạch",
    },
    giaThiTruong: {
      diffPercent: diff,
      diffAmount: diff > 0 ? `Rẻ hơn ~${diff}%` : diff < 0 ? `Cao hơn ${Math.abs(diff)}%` : "Ngang thị trường",
      label: diff > 10 ? `Rẻ hơn ${Math.abs(diff)}%` : diff < 0 ? `Đắt hơn ${Math.abs(diff)}%` : "Đúng giá",
      detail:
        pricePerM2 !== ""
          ? `${price} / ${area} ~ ${pricePerM2}`
          : diff > 0
            ? `Thấp hơn trung bình khu ${street}`
            : "So với mặt bằng Vũng Tàu",
    },
    viTri: {
      score: viTriScore,
      label: street,
      detail:
        viTriScore > 85
          ? "Mặt tiền Thùy Vân - trung tâm du lịch, cách biển 50m"
          : viTriScore > 70
            ? `${street} - khu du lịch phát triển`
            : `${street} - khu dân cư`,
    },
  };

  const hitList = hits.join(", ");

  // 7) Lý luận
  let reasoning = "";
  if (overall >= 80) {
    reasoning = `Giá ${price} cho ${area} tại ${street} rẻ hơn trung bình khu vực (${breakdown.giaThiTruong.diffAmount}). Từ khóa "${hitList}" cho thấy chủ đang kẹt thật, không phải chiêu marketing. Vị trí ${breakdown.viTri.detail.toLowerCase()} với tiềm năng tăng giá ${tangGia}/100 nhờ du lịch Vũng Tàu phục hồi mạnh 2024-2025. Pháp lý ${phapLy}% an toàn. Đây là kèo ngộp thơm đúng nghĩa - biên lợi nhuận 15-20% nếu bán lại sau 6-12 tháng.`;
  } else if (overall >= 50) {
    reasoning = `Tin này ở mức trung bình khá. Giá ${price} tương đối hợp lý so với ${street}, nhưng chưa đủ độ ngộp để gọi là kèo thơm. ${
      ngop > 60 ? "Có dấu hiệu cần tiền nhưng chưa rõ ràng, cần gọi kiểm chứng." : "Không có tín hiệu bán gấp rõ rệt."
    } Vị trí ${breakdown.viTri.detail.toLowerCase()}, thanh khoản ${thanhKhoan}/100. Nếu ép được giá thêm 5-7% thì thành kèo ngon.`;
  } else {
    const risks: string[] = [];
    if (n.includes("hẻm nhỏ")) risks.push("hẻm nhỏ kén khách");
    if (n.includes("quy hoạch treo")) risks.push("dính quy hoạch treo");
    if (n.includes("tranh chấp")) risks.push("tranh chấp");
    if (n.includes("giấy tay")) risks.push("pháp lý giấy tay");
    if (diff < 0) risks.push(`giá cao hơn thị trường ${Math.abs(diff)}%`);
    reasoning = `AI cảnh báo rủi ro: ${risks.join(", ") || "giá chưa thơm"}. Với ${price} cho ${area} ở ${street}, mức giá này đang ${
      diff < 0 ? "ngáo hơn thị trường" : "không rẻ"
    }. ${phapLy < 50 ? "Pháp lý yếu, rất khó vay bank và bán lại." : "Thanh khoản thấp, ôm lâu chôn vốn."} Đây không phải kèo ngộp mà là kèo ngộp... người mua. Nên bỏ qua.`;
  }

  // 8) Hành động đề xuất
  let action = "";
  if (actionType === "hot") {
    action =
      "🔥 NÊN GỌI NGAY CHỦ - Check quy hoạch trên cổng thông tin BR-VT, hẹn xem sổ gốc, chuẩn bị cọc 100tr giữ chỗ. Kèo này bay trong 24-48h. Nếu pháp lý ok, vào luôn.";
  } else if (actionType === "ok") {
    action =
      "👉 Gọi hỏi kỹ lý do bán, ép giá thêm 5-10%, yêu cầu xem sổ và check quy hoạch. Nếu chủ thiện chí hạ thêm thì cân nhắc vào.";
  } else {
    action =
      "⛔ BỎ QUA - Giá cao, pháp lý hoặc vị trí không thơm. Đừng tiếc, Vũng Tàu còn nhiều kèo khác. Dùng bộ lọc AI để săn tin mới.";
  }

  return {
    overall,
    tag,
    tagColor,
    breakdown,
    reasoning,
    action,
    actionType,
    extracted: { price, area, street },
  };
}

// Đánh giá từ phản hồi AI: nhận điểm tổng hợp + 5 chỉ số phụ rồi ánh xạ về cùng model UI
export function fromApiResponse(data: CheckApiResponse, local: AnalysisResult): AnalysisResult {
  const score = typeof data.investment_score === "number" ? data.investment_score : local.overall;
  const deal = data.deal_type || "binh_thuong";

  let tag: string;
  let tagColor: TagColor;
  let actionType: ActionType;
  if (score >= 80 && deal === "ngop_ngon") {
    tag = "KÈO NGỘP NGON";
    tagColor = "green";
    actionType = "hot";
  } else if (score >= 80) {
    tag = "TIỀM NĂNG CAO";
    tagColor = "green";
    actionType = "hot";
  } else if (score >= 50 && deal !== "rui_ro_phap_ly" && deal !== "gia_cao") {
    tag = "CÂN NHẮC ĐƯỢC";
    tagColor = "yellow";
    actionType = "ok";
  } else {
    tag = deal === "gia_cao" ? "GIÁ CAO HƠN THỊ TRƯỜNG" : "RỦI RO CAO - NÊN BỎ QUA";
    tagColor = "red";
    actionType = "skip";
  }

  // AI trả điểm 0-4 cho 2 chỉ số nên quy về thang 100 cho khớp UI
  const toHundred = (v: number) => (v <= 4 ? Math.round((v / 4) * 100) : Math.round(v));

  return {
    ...local,
    overall: score,
    tag,
    tagColor,
    actionType,
    breakdown: {
      ...local.breakdown,
      ngop: { ...local.breakdown.ngop, score: typeof data.is_ngop === "number" ? data.is_ngop : local.breakdown.ngop.score },
      phapLy: {
        ...local.breakdown.phapLy,
        score: typeof data.legal_safety === "number" ? data.legal_safety : local.breakdown.phapLy.score,
      },
      tangGia: {
        ...local.breakdown.tangGia,
        score: typeof data.location_growth === "number" ? toHundred(data.location_growth) : local.breakdown.tangGia.score,
      },
      thanhKhoan: {
        ...local.breakdown.thanhKhoan,
        score: typeof data.liquidity === "number" ? toHundred(data.liquidity) : local.breakdown.thanhKhoan.score,
      },
    },
  };
}
