// Kiểu dữ liệu dùng chung cho kết quả phân tích 1 tin BĐS

export interface BreakdownItem {
  score: number;
  label: string;
  detail: string;
}

export interface PriceCompare {
  diffPercent: number;
  diffAmount: string;
  label: string;
  detail: string;
}

export interface AnalysisBreakdown {
  ngop: BreakdownItem;
  tangGia: BreakdownItem;
  thanhKhoan: BreakdownItem;
  phapLy: BreakdownItem;
  giaThiTruong: PriceCompare;
  viTri: BreakdownItem;
}

export type TagColor = "green" | "yellow" | "red";
export type ActionType = "hot" | "ok" | "skip";

export interface AnalysisResult {
  overall: number;
  tag: string;
  tagColor: TagColor;
  breakdown: AnalysisBreakdown;
  reasoning: string;
  action: string;
  actionType: ActionType;
  extracted: { price: string; area: string; street: string };
}

// Phản hồi chuẩn của POST /api/check
export interface CheckApiResponse {
  investment_score: number;
  deal_type: string;
  confidence: number;
  is_ngop: number;
  legal_safety: number;
  location_growth: number;
  liquidity: number;
  raw?: unknown;
  error?: string;
}
