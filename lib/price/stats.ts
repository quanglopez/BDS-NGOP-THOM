// Tính thống kê giá tham chiếu — HÀM THUẦN, không I/O, không mạng, không DB.
// Mọi quy tắc data quality của price-v1 nằm ở đây để test được độc lập.

import {
  MIN_SAMPLE_SIZE,
  PPM2_MAX,
  PPM2_MIN,
  SIZE_BAND_RATIO_MAX,
  SIZE_BAND_RATIO_MIN,
  type ExclusionCounts,
  type ExclusionReason,
  type NormalizedListing,
  type PriceConfidence,
  type PriceScope,
  type PriceStatistics,
  type ScopeLevel,
} from "./types";

/** Giá trên m² — LUÔN tự tính, không dùng price_million_per_m2 của gateway. */
export function calcPpm2(priceVnd: number | null, sizeM2: number | null): number | null {
  if (priceVnd == null || sizeM2 == null) return null;
  if (!Number.isFinite(priceVnd) || !Number.isFinite(sizeM2)) return null;
  if (!(priceVnd > 0) || !(sizeM2 > 0)) return null;
  return priceVnd / sizeM2;
}

export function emptyExclusionCounts(): ExclusionCounts {
  return {
    rent: 0,
    invalid_price_flag: 0,
    invalid_size: 0,
    invalid_price: 0,
    category_mismatch: 0,
    promoted: 0,
    ppm2_out_of_range: 0,
    size_out_of_band: 0,
    rooms_out_of_band: 0,
    duplicate_external_id: 0,
  };
}

/**
 * Lọc 1 tin khỏi mẫu. Thứ tự có chủ đích để phân loại lý do chính xác
 * (ví dụ tin cho thuê thì báo "rent", không báo "invalid_price").
 * Tin quảng cáo nổi bật (promoted) bị loại Ở ĐÂY, nhưng vẫn được lưu cache.
 */
export function classifyListing(
  listing: NormalizedListing,
  scope: PriceScope,
): ExclusionReason | null {
  if (listing.is_rent) return "rent";
  if (!listing.is_price_valid) return "invalid_price_flag";
  if (listing.size_m2 == null || !(listing.size_m2 > 0)) return "invalid_size";
  if (listing.price_vnd == null || !(listing.price_vnd > 0)) return "invalid_price";
  if (listing.category_code !== scope.category_code) return "category_mismatch";
  if (listing.is_promoted) return "promoted";
  if (listing.price_per_m2 < PPM2_MIN || listing.price_per_m2 > PPM2_MAX) return "ppm2_out_of_range";
  if (scope.size_min_m2 != null && listing.size_m2 < scope.size_min_m2) return "size_out_of_band";
  if (scope.size_max_m2 != null && listing.size_m2 > scope.size_max_m2) return "size_out_of_band";
  if (scope.rooms_min != null && (listing.rooms == null || listing.rooms < scope.rooms_min)) {
    return "rooms_out_of_band";
  }
  if (scope.rooms_max != null && (listing.rooms == null || listing.rooms > scope.rooms_max)) {
    return "rooms_out_of_band";
  }
  return null;
}

export interface FilterResult {
  kept: NormalizedListing[];
  excluded: ExclusionCounts;
  /** Số tin bị loại vì trùng external_id (giữ tin đầu tiên). */
  duplicates: number;
}

/** Áp bộ lọc + khử trùng theo external_id. */
export function filterSample(
  listings: NormalizedListing[],
  scope: PriceScope,
): FilterResult {
  const excluded = emptyExclusionCounts();
  const kept: NormalizedListing[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const l of listings) {
    const key = l.external_id;
    if (key && seen.has(key)) {
      duplicates += 1;
      excluded.duplicate_external_id += 1;
      continue;
    }
    const reason = classifyListing(l, scope);
    if (reason) {
      excluded[reason] += 1;
      continue;
    }
    if (key) seen.add(key);
    kept.push(l);
  }

  return { kept, excluded, duplicates };
}

/** Nội suy linear trên mảng ĐÃ SẮP XẾP tăng dần. */
export function percentile(sortedAsc: number[], p: number): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  if (n === 1) return sortedAsc[0];
  const idx = (n - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/** Trim IQR: giữ các giá trị trong [Q1 − 1.5·IQR, Q3 + 1.5·IQR]. */
export function trimIqr(values: number[]): { kept: number[]; lower: number; upper: number } {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { kept: [], lower: 0, upper: 0 };
  const q1 = percentile(sorted, 0.25)!;
  const q3 = percentile(sorted, 0.75)!;
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  // IQR = 0 (mọi giá trị bằng nhau) -> giữ hết, không vô tình loại sạch
  if (!(iqr > 0)) return { kept: sorted, lower, upper };
  return { kept: sorted.filter((v) => v >= lower && v <= upper), lower, upper };
}

/** 0..1. Chỉ lưu vào DB để đo sau này — KHÔNG dùng làm confidence. */
export function qualityScore(args: {
  trimmed: number;
  sample: number;
  scopeLevel: ScopeLevel;
}): number | null {
  const { trimmed, sample, scopeLevel } = args;
  if (!(sample > 0)) return null;
  const samplePart = Math.min(1, trimmed / 60);
  const ratioPart = trimmed / sample;
  const scopePart = scopeLevel === "ward" ? 1 : scopeLevel === "district" ? 0.8 : 0.6;
  const score = 0.5 * samplePart + 0.2 * ratioPart + 0.3 * scopePart;
  return Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000;
}

/**
 * Confidence theo quy tắc đơn giản đã duyệt — dễ giải thích, không tối ưu scoring.
 *
 * Mở rộng phạm vi làm mẫu KHÔNG còn cùng vị trí với tin, nên tầng quận bị CHẶN
 * trần "medium": dữ liệu quận vẫn cục bộ, nhưng không được tôn như dữ liệu phường.
 * Ngưỡng tầng tỉnh giữ nguyên như cũ.
 */
export function confidenceFrom(args: {
  scopeLevel: ScopeLevel;
  trimmed: number;
}): PriceConfidence {
  const { scopeLevel, trimmed } = args;
  if (scopeLevel === "ward" && trimmed >= 30) return "high";
  if (scopeLevel === "ward" && trimmed >= 15) return "medium";
  // Quận: đủ số mẫu thì lên "medium", KHÔNG bao giờ "high" (đã mở rộng phạm vi).
  if (scopeLevel === "district" && trimmed >= 15) return "medium";
  if (scopeLevel === "province" && trimmed >= 30) return "medium";
  return "low";
}

export interface StatsResult {
  sample_size: number;
  trimmed_size: number;
  statistics: PriceStatistics | null;
  quality_score: number | null;
  confidence: PriceConfidence;
  excluded: ExclusionCounts;
}

/**
 * Thống kê cuối cùng.
 * - KHÔNG dùng mean.
 * - sample_size < MIN_SAMPLE_SIZE -> statistics = null (không tạo số cho có).
 */
export function computeStats(args: {
  filtered: FilterResult;
  scopeLevel: ScopeLevel;
}): StatsResult {
  const { filtered, scopeLevel } = args;
  const sampleSize = filtered.kept.length;
  const values = filtered.kept.map((l) => l.price_per_m2).filter((v) => Number.isFinite(v));
  const { kept } = trimIqr(values);
  const trimmedSize = kept.length;

  let statistics: PriceStatistics | null = null;
  if (sampleSize >= MIN_SAMPLE_SIZE && trimmedSize > 0) {
    const sorted = [...kept].sort((a, b) => a - b);
    statistics = {
      p25_ppm2: Math.round(percentile(sorted, 0.25)!),
      median_ppm2: Math.round(percentile(sorted, 0.5)!),
      p75_ppm2: Math.round(percentile(sorted, 0.75)!),
      min_ppm2: Math.round(sorted[0]),
      max_ppm2: Math.round(sorted[sorted.length - 1]),
    };
  }

  return {
    sample_size: sampleSize,
    trimmed_size: trimmedSize,
    statistics,
    quality_score: qualityScore({ trimmed: trimmedSize, sample: sampleSize, scopeLevel }),
    confidence: confidenceFrom({ scopeLevel, trimmed: trimmedSize }),
    excluded: filtered.excluded,
  };
}

/** % chênh lệch so với median nhóm tham chiếu. null khi chưa có statistics. */
export function differencePercent(targetPpm2: number | null, medianPpm2: number | null): number | null {
  if (targetPpm2 == null || medianPpm2 == null) return null;
  if (!Number.isFinite(targetPpm2) || !Number.isFinite(medianPpm2)) return null;
  if (!(medianPpm2 > 0)) return null;
  const diff = ((targetPpm2 - medianPpm2) / medianPpm2) * 100;
  return Math.round(diff * 10) / 10;
}

export { SIZE_BAND_RATIO_MAX, SIZE_BAND_RATIO_MIN };
