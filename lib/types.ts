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
export interface QuotaInfo {
  plan: string;
  limit: number;
  used: number;
  credits: number;
  remaining: number;
}

export interface CheckApiResponse {
  check_id?: string | null;
  /** Slug SEO đã ghi trong DB; null/undefined khi ghi lỗi -> dùng URL UUID. */
  seo_slug?: string | null;
  /**
   * Điểm 0-100. Cột DB nullable nhưng luồng này chỉ ghi khi Jev trả score hợp
   * lệ (thiếu/hỏng -> 502, KHÔNG phải 0). 0 là điểm THẬT.
   */
  investment_score: number;
  /**
   * Phân loại do provider trả về. `null` = provider KHÔNG trả classification hợp
   * lệ (thiếu, hoặc choice lạ ngoài bộ criteria) — KHÔNG phải "bình thường".
   * Chỉ dùng "binh_thuong" khi provider thực sự trả ra giá trị đó.
   */
  deal_type: string | null;
  /** Confidence của provider (0..1). null = provider không trả. */
  confidence: number | null;
  /**
   * Noul ngộp 0..100. `null` = provider không trả noul hợp lệ — KHÔNG quy về 0,
   * vì 0 là kết luận thật ("không ngộp"). applyJevSubScores() giữ điểm local
   * khi gặp null, nên không mất thông tin.
   */
  is_ngop: number | null;
  legal_safety: number | null;
  location_growth: number | null;
  liquidity: number | null;
  province?: string | null;
  price_billion?: number | null;
  area_m2?: number | null;
  analyzed_at?: string;
  quota?: QuotaInfo;
  /** true khi server trả điểm đã chấm trước đó từ score cache (không gọi lại AI). */
  cached?: boolean;
  raw?: unknown;
  error?: string;
}
