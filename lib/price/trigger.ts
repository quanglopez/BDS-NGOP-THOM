// Điều phối tải Price Intelligence cho 1 report.
//
// Tách ra khỏi React để test được bằng harness hiện tại (node script, không có
// jsdom/@testing-library). Component chỉ là lớp vẽ theo view-model.
//
// Nguyên tắc:
//  - Free: KHÔNG gọi mạng (0 GET, 0 POST)
//  - Luôn GET trước (rẻ, không crawl). Chỉ POST khi server nói not_generated.
//  - Tối đa 1 POST cho mỗi lần mở report. Không retry loop.
//  - Mọi lỗi -> state "unavailable", không ném ra ngoài, không chặn report.

import { CONFIDENCE_META, type PriceComparable, type PriceIntelligence } from "./types";
import { canShowStatistics } from "./pipeline";

export interface PriceFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type PriceFetchLike = (
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
) => Promise<PriceFetchResponse>;

export type PriceLoadState = "idle" | "locked" | "ready" | "not_enough" | "unavailable";

export interface PriceLoadResult {
  state: PriceLoadState;
  data: PriceIntelligence | null;
  cached: boolean;
  getCalls: number;
  postCalls: number;
  message: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function messageOf(v: unknown, fallback: string): string {
  return isRecord(v) && typeof v.message === "string" && v.message.trim() ? v.message : fallback;
}

export async function loadPriceIntelligence(args: {
  checkId: string;
  isPro: boolean;
  fetchImpl: PriceFetchLike;
  endpoint?: string;
}): Promise<PriceLoadResult> {
  const { checkId, isPro, fetchImpl } = args;
  const endpoint = args.endpoint ?? "/api/price-intelligence";
  const base: PriceLoadResult = {
    state: "idle",
    data: null,
    cached: false,
    getCalls: 0,
    postCalls: 0,
    message: null,
  };

  // Free: không gọi mạng. 0 GET, 0 POST.
  if (!isPro) return { ...base, state: "locked" };

  const headers = { "Content-Type": "application/json" };
  let getCalls = 0;
  let postCalls = 0;

  // Bước 1: GET — chỉ đọc, không crawl.
  let needPost = false;
  try {
    getCalls += 1;
    const res = await fetchImpl(`${endpoint}?checkId=${encodeURIComponent(checkId)}`, {
      method: "GET",
      headers,
    });
    if (res.ok) {
      const body = (await res.json()) as unknown;
      if (isRecord(body) && body.ok === true && isRecord(body.data)) {
        return {
          state: "ready",
          data: body.data as unknown as PriceIntelligence,
          cached: body.cached === true,
          getCalls,
          postCalls,
          message: null,
        };
      }
      const reason = isRecord(body) && typeof body.reason === "string" ? body.reason : "";
      if (reason === "not_generated") {
        needPost = true;
      } else {
        return {
          state: reason === "not_enough_data" ? "not_enough" : "unavailable",
          data: null,
          cached: false,
          getCalls,
          postCalls,
          message: messageOf(body, "Phân tích giá tham chiếu tạm thời chưa khả dụng."),
        };
      }
    } else if (res.status === 401 || res.status === 403 || res.status === 404) {
      // Không sở hữu / hết phiên / không thấy -> KHÔNG thử POST.
      return {
        state: res.status === 403 ? "locked" : "unavailable",
        data: null,
        cached: false,
        getCalls,
        postCalls,
        message: null,
      };
    } else {
      // 429, 5xx -> không POST để tránh dội thêm request
      return { ...base, state: "unavailable", getCalls, postCalls };
    }
  } catch {
    return { ...base, state: "unavailable", getCalls, postCalls };
  }

  // Bước 2: POST — chỉ khi GET nói not_generated. Tối đa 1 lần.
  if (needPost) {
    try {
      postCalls += 1;
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ checkId }),
      });
      if (res.ok) {
        const body = (await res.json()) as unknown;
        if (isRecord(body) && body.ok === true && isRecord(body.data)) {
          return {
            state: "ready",
            data: body.data as unknown as PriceIntelligence,
            cached: false,
            getCalls,
            postCalls,
            message: null,
          };
        }
        const reason = isRecord(body) && typeof body.reason === "string" ? body.reason : "";
        return {
          state: reason === "not_enough_data" ? "not_enough" : "unavailable",
          data: null,
          cached: false,
          getCalls,
          postCalls,
          message: messageOf(body, "Phân tích giá tham chiếu tạm thời chưa khả dụng."),
        };
      }
      return { ...base, state: "unavailable", getCalls, postCalls };
    } catch {
      return { ...base, state: "unavailable", getCalls, postCalls };
    }
  }

  return { ...base, state: "unavailable", getCalls, postCalls };
}

// ---------------------------------------------------------------- view model

export interface PriceViewModel {
  showSkeleton: boolean;
  locked: boolean;
  heading: string;
  scopeDescription: string | null;
  scopeLevel: string | null;
  confidence: { label: string; badge: string; tooltip: string } | null;
  sampleSize: number;
  trimmedSize: number;
  excludedInvalid: number;
  excludedPromoted: number;
  /** Câu mô tả nguồn mẫu, luôn nói rõ đã loại bao nhiêu tin. */
  sampleLine: string;
  canShowStats: boolean;
  targetPpm2: number | null;
  medianPpm2: number | null;
  p25Ppm2: number | null;
  p75Ppm2: number | null;
  minPpm2: number | null;
  maxPpm2: number | null;
  differencePercent: number | null;
  comparables: PriceComparable[];
  limitations: string[];
  message: string | null;
}

const LOCKED_HEADING = "Mở khóa phân tích giá tham chiếu";

function buildSampleLine(s: PriceIntelligence): string {
  const parts: string[] = [];
  if (s.excluded_invalid > 0) parts.push(`${s.excluded_invalid} tin không phù hợp`);
  if (s.excluded_promoted > 0) parts.push(`${s.excluded_promoted} tin quảng cáo`);
  const base = `Dựa trên ${s.sample_size} tin đăng hợp lệ`;
  return parts.length > 0 ? `${base} (đã loại ${parts.join(" và ")})` : `${base}.`;
}

/**
 * Chuyển kết quả tải thành view-model để UI chỉ việc render.
 * - Chưa có dữ liệu -> skeleton riêng của phần giá (KHÔNG dùng skeleton AI)
 * - not_enough -> lời giải thích, KHÔNG hiện số nào
 */
export function buildPriceViewModel(result: PriceLoadResult | null): PriceViewModel {
  const empty: PriceViewModel = {
    showSkeleton: true,
    locked: false,
    heading: "Phân tích giá tham chiếu",
    scopeDescription: null,
    scopeLevel: null,
    confidence: null,
    sampleSize: 0,
    trimmedSize: 0,
    excludedInvalid: 0,
    excludedPromoted: 0,
    sampleLine: "",
    canShowStats: false,
    targetPpm2: null,
    medianPpm2: null,
    p25Ppm2: null,
    p75Ppm2: null,
    minPpm2: null,
    maxPpm2: null,
    differencePercent: null,
    comparables: [],
    limitations: [],
    message: null,
  };

  if (!result) return empty;

  if (result.state === "locked") {
    return { ...empty, showSkeleton: false, locked: true, heading: LOCKED_HEADING };
  }

  if (result.state === "unavailable" || result.state === "not_enough") {
    return {
      ...empty,
      showSkeleton: false,
      message:
        result.message ??
        (result.state === "not_enough"
          ? "Chưa đủ dữ liệu tham chiếu cho khu vực này."
          : "Phân tích giá tham chiếu tạm thời chưa khả dụng."),
    };
  }

  const s = result.data;
  if (!s) return { ...empty, showSkeleton: false, message: "Phân tích giá tham chiếu tạm thời chưa khả dụng." };

  const stats = canShowStatistics(s) ? s.statistics : null;

  return {
    showSkeleton: false,
    locked: false,
    heading: "Phân tích giá tham chiếu",
    scopeDescription: s.scope?.scope_description ?? null,
    scopeLevel: s.scope_level ?? null,
    confidence: s.confidence ? CONFIDENCE_META[s.confidence] : null,
    sampleSize: s.sample_size,
    trimmedSize: s.trimmed_size,
    excludedInvalid: s.excluded_invalid,
    excludedPromoted: s.excluded_promoted,
    sampleLine: buildSampleLine(s),
    canShowStats: stats !== null,
    targetPpm2: s.target?.price_per_m2 ?? null,
    medianPpm2: stats?.median_ppm2 ?? null,
    p25Ppm2: stats?.p25_ppm2 ?? null,
    p75Ppm2: stats?.p75_ppm2 ?? null,
    minPpm2: stats?.min_ppm2 ?? null,
    maxPpm2: stats?.max_ppm2 ?? null,
    differencePercent: s.target?.difference_percent ?? null,
    comparables: Array.isArray(s.comparables) ? s.comparables.slice(0, 6) : [],
    limitations: Array.isArray(s.limitations) ? s.limitations : [],
    message: null,
  };
}
