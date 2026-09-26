// Giải thích "tại sao tin này được N điểm": tách điểm thành các yếu tố +/−
// so với mức trung bình 50. Trọng số lấy đúng từ công thức chấm điểm
// (ngộp 25% • tăng giá 25% • thanh khoản 15% • pháp lý 15% • giá thị trường 20%).

import type { AnalysisResult } from "./types";

export interface ScoreContribution {
  label: string;
  delta: number;
  note: string;
  kind: "plus" | "minus" | "neutral";
}

const WEIGHTS: { key: "ngop" | "tangGia" | "thanhKhoan" | "phapLy"; label: string; w: number }[] = [
  { key: "ngop", label: "Dấu hiệu bán gấp", w: 0.25 },
  { key: "tangGia", label: "Tiềm năng tăng giá khu vực", w: 0.25 },
  { key: "thanhKhoan", label: "Thanh khoản", w: 0.15 },
  { key: "phapLy", label: "Pháp lý", w: 0.15 },
];

export function scoreContributions(result: AnalysisResult): ScoreContribution[] {
  const out: ScoreContribution[] = [];

  for (const { key, label, w } of WEIGHTS) {
    const item = result.breakdown[key];
    const delta = Math.round((item.score - 50) * w);
    out.push({ label, delta, note: item.detail, kind: delta > 0 ? "plus" : delta < 0 ? "minus" : "neutral" });
  }

  // Yếu tố giá: chênh lệch so với thị trường (dương = rẻ hơn)
  const diff = result.breakdown.giaThiTruong.diffPercent;
  const giaDelta = Math.round(diff * 0.3);
  out.push({
    label: diff > 0 ? "Giá thấp hơn mặt bằng khu vực" : diff < 0 ? "Giá cao hơn thị trường" : "Giá sát mặt bằng",
    delta: giaDelta,
    note: result.breakdown.giaThiTruong.detail,
    kind: giaDelta > 0 ? "plus" : giaDelta < 0 ? "minus" : "neutral",
  });

  // Các yếu tố trừ điểm rủi ro (công thức trừ 25 khi có bất kỳ dấu hiệu nào)
  const risks: string[] = [];
  const n = result.reasoning.toLowerCase();
  if (result.actionType === "skip") {
    if (result.breakdown.giaThiTruong.diffPercent < 0) risks.push("giá cao hơn thị trường");
    if (result.breakdown.phapLy.score < 50) risks.push("pháp lý yếu");
    if (result.breakdown.thanhKhoan.score < 50) risks.push("thanh khoản thấp");
    if (n.includes("quy hoạch")) risks.push("quy hoạch treo");
    if (n.includes("tranh chấp")) risks.push("tranh chấp");
  }
  if (risks.length > 0) {
    out.push({
      label: "Yếu tố rủi ro",
      delta: -25,
      note: risks.join(", "),
      kind: "minus",
    });
  }

  // Sắp theo mức ảnh hưởng giảm dần để người xem đọc nhanh
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
