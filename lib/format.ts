// Label tiếng Việt cho các loại kèo do AI phân loại

export const DEAL_LABELS: Record<string, string> = {
  ngop_ngon: "KÈO NGỘP NGON",
  thom_dau_tu: "TIỀM NĂNG CAO",
  gia_cao: "GIÁ CAO HƠN TT",
  rui_ro_phap_ly: "RỦI RO PHÁP LÝ",
  binh_thuong: "BÌNH THƯỜNG",
};

export function dealLabel(deal: string | null | undefined): string {
  if (deal === null || deal === undefined) return "CHƯA CHẤM";
  return DEAL_LABELS[deal] ?? "BÌNH THƯỜNG";
}

// Màu badge theo loại kèo
export function dealBadgeClass(deal: string | null | undefined): string {
  switch (deal) {
    case "ngop_ngon":
    case "thom_dau_tu":
      return "bg-emerald-600 text-white";
    case "gia_cao":
    case "rui_ro_phap_ly":
      return "bg-red-600 text-white";
    default:
      return "bg-slate-200 text-slate-600";
  }
}

export function scoreBadgeClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return "bg-slate-200 text-slate-500";
  if (score >= 80) return "bg-emerald-600 text-white";
  if (score >= 50) return "bg-amber-400 text-amber-950";
  return "bg-red-500 text-white";
}
