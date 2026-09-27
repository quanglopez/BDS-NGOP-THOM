// P1 Price Intelligence — kiểu dữ liệu dùng chung.
// Snapshot là BẤT BIẾN: có rồi thì không tính lại (giống analysis_json của Pro).

/** Tầng địa lý thật của gateway: tỉnh / quận-phường. Không có tầng trung gian. */
export type ScopeLevel = "ward" | "province";

export type PriceConfidence = "low" | "medium" | "high";

// Ngưỡng số mẫu tối thiểu. Dưới ngưỡng này KHÔNG hiện median/percentile/band.
export const MIN_SAMPLE_SIZE = 15;

// Khoảng ppm2 hợp lý (VND/m²). Ngoài khoảng = tin rác, loại. Không tự bóp thêm.
export const PPM2_MIN = 5_000_000;
export const PPM2_MAX = 2_000_000_000;

// Band diện tích động theo diện tích tin đang check.
export const SIZE_BAND_RATIO_MIN = 0.6;
export const SIZE_BAND_RATIO_MAX = 1.6;

export const PRICE_INTELLIGENCE_VERSION = "price-v1";
export const MARKET_SOURCE = "chotot_gateway";

// Nhãn hiển thị cho confidence. KHÔNG show quality_score ra UI — chỉ 3 mức này.
export const CONFIDENCE_META: Record<
  PriceConfidence,
  { label: string; badge: string; tooltip: string }
> = {
  high: {
    label: "Cao",
    badge: "🟢",
    tooltip: "Dựa trên nhiều tin tương đồng trong cùng khu vực.",
  },
  medium: {
    label: "Trung bình",
    badge: "🟡",
    tooltip: "Có dữ liệu tham chiếu nhưng phạm vi rộng hơn.",
  },
  low: {
    label: "Thấp",
    badge: "⚪",
    tooltip: "Dữ liệu còn hạn chế.",
  },
};

export interface PriceScope {
  scope_level: ScopeLevel;
  scope_key: string;
  scope_description: string;
  region_name: string | null;
  area_name: string | null;
  category_code: number;
  category_name: string | null;
  size_min_m2: number | null;
  size_max_m2: number | null;
  // Gateway chỉ lọc được rooms TỐI THIỂU, nên rooms_min đẩy xuống server,
  // rooms_max lọc tiếp phía mình.
  rooms_min: number | null;
  rooms_max: number | null;
}

/** Kết quả dựng scope: Tier 1, Tier 2, hoặc không đủ dữ liệu để crawl. */
export type ScopeResolution =
  | { ok: true; scope: PriceScope; tier: 1 | 2 }
  | { ok: false; reason: string };

/** Lý do loại 1 tin khỏi mẫu thống kê. */
export type ExclusionReason =
  | "rent"
  | "invalid_price_flag"
  | "invalid_size"
  | "invalid_price"
  | "category_mismatch"
  | "promoted"
  | "ppm2_out_of_range"
  | "size_out_of_band"
  | "rooms_out_of_band";

export interface ExclusionCounts {
  rent: number;
  invalid_price_flag: number;
  invalid_size: number;
  invalid_price: number;
  category_mismatch: number;
  promoted: number;
  ppm2_out_of_range: number;
  size_out_of_band: number;
  rooms_out_of_band: number;
  duplicate_external_id: number;
}

export interface PriceStatistics {
  p25_ppm2: number;
  median_ppm2: number;
  p75_ppm2: number;
  min_ppm2: number;
  max_ppm2: number;
}

export interface PriceComparable {
  external_id: string;
  title: string | null;
  size_m2: number | null;
  price_vnd: number | null;
  price_per_m2: number;
  rooms: number | null;
  // km nếu có tọa độ cả hai đầu. null => hiển thị "Cùng phường"/"Cùng khu vực".
  distance_km: number | null;
  listed_at: string | null;
  url: string | null;
}

export interface PriceIntelligence {
  version: string;
  generated_at: string;
  source: string;
  scope_level: ScopeLevel;
  scope: PriceScope;
  // n sau khi loại tin rác, trước trim
  sample_size: number;
  // n sau trim IQR — con số thật sự dùng để tính thống kê
  trimmed_size: number;
  confidence: PriceConfidence;
  quality_score: number | null;
  // Số tin bị loại, để UI nói rõ "đã loại N tin ngoài dải" — không im lặng
  excluded_promoted: number;
  excluded_invalid: number;
  // null KHI sample_size < MIN_SAMPLE_SIZE. Không tạo số để điền cho có.
  statistics: PriceStatistics | null;
  comparables: PriceComparable[];
  target: {
    price_per_m2: number | null;
    // % chênh lệch so với median nhóm tham chiếu. null khi không có statistics.
    difference_percent: number | null;
  };
  limitations: string[];
}

export interface PriceStatsRow {
  scope_key: string;
  stat_date: string;
  scope_level: ScopeLevel;
  scope_description: string;
  region_name: string | null;
  area_name: string | null;
  category_code: number;
  size_min_m2: number | null;
  size_max_m2: number | null;
  rooms: number | null;
  sample_size: number;
  trimmed_size: number;
  excluded_promoted: number;
  excluded_invalid: number;
  p25_ppm2: number | null;
  median_ppm2: number | null;
  p75_ppm2: number | null;
  min_ppm2: number | null;
  max_ppm2: number | null;
  quality_score: number | null;
  source: string;
  computed_at: string;
}

// Số chuẩn hoá 1 dòng crawl -> đã tính ppm2 + cờ loại. Tạo trong pipeline.
export interface NormalizedListing {
  source: string;
  external_id: string;
  category_code: number | null;
  category_name: string | null;
  region_name: string | null;
  region_v2: number | null;
  area_name: string | null;
  area_v2: number | null;
  title: string | null;
  price_vnd: number | null;
  size_m2: number | null;
  living_size_m2: number | null;
  land_front_m: number | null;
  land_side_m: number | null;
  rooms: number | null;
  price_per_m2: number;
  lat: number | null;
  lng: number | null;
  listed_at: string | null;
  url: string | null;
  is_price_valid: boolean;
  is_promoted: boolean;
  is_rent: boolean;
}
