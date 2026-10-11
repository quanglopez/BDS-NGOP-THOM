import { analyzeListing, fromApiResponse } from "@/lib/scoring";
import type { AnalysisResult, CheckApiResponse, QuotaInfo } from "@/lib/types";
import { trackEvent } from "@/lib/analytics";

export type CheckSource = "ai" | "local";

export interface CheckOutcome {
  result: AnalysisResult;
  source: CheckSource;
  // Thời điểm server trả kết quả (ISO) - dùng để hiển thị, không phải đồng hồ client
  analyzedAt?: string;
  // true khi khách CHƯA đăng nhập (server từ chối) -> UI nói "bản xem trước"
  // khác với "đăng nhập rồi nhưng AI lỗi" (không được nói là xem trước)
  authRequired?: boolean;
  // true khi đã dùng hết lượt trong ngày (HTTP 429) -> UI phải nói rõ thay vì
  // im lặng trả kết quả dự phòng, khiến khách tưởng còn lượt
  quotaExhausted?: boolean;
  // Thông báo lỗi nguyên bản từ server (vd "Hết 20 lượt check/ngày của gói free")
  serverError?: string;
  // ID dòng checks vừa lưu (để mở /bao-cao/[id]). Null khi preview local / lỗi.
  checkId?: string | null;
  // Slug SEO đã ghi trong DB. null khi ghi lỗi (thiếu cột, trùng slug) —
  // khi đó URL UUID vẫn mở được.
  seoSlug?: string | null;
  // Confidence 0..1 của provider. null/undefined = provider không trả (KHÔNG
  // phải 0). Chỉ có ở nhánh source "ai".
  confidence?: number | null;
  // Server trả kết quả đã chấm trước đó từ score cache (không gọi lại AI).
  cached?: boolean;
}

// Thông tin kèm theo khi check (người đăng + địa lý có cấu trúc).
// `ward`/`region` là 2 key /api/check đọc để dựng geo (resolveListingGeo).
// Không gửi -> cột geo NULL -> Price Intelligence chỉ lên được tỉnh.
export interface ContactInfo {
  contactName?: string | null;
  phone?: string | null;
  listingUrl?: string | null;
  /** Tên phường lấy từ nguồn có cấu trúc, ví dụ "Phường Hoà Hải". */
  ward?: string | null;
  /** Tên tỉnh lấy từ nguồn có cấu trúc, ví dụ "Đà Nẵng". */
  region?: string | null;
  /** Diện tích có cấu trúc từ /api/extract (ví dụ "66 m²"). Ưu tiên hơn quét text. */
  areaHint?: string | null;
}

// Gọi /api/check; nếu server thiếu key hoặc AI lỗi thì fallback scoring local
export async function runCheck(text: string, contact?: ContactInfo): Promise<CheckOutcome> {
  const local = analyzeListing(text);

  try {
    const res = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, ...(contact ?? {}) }),
    });

    if (res.status === 401) {
      // Chưa đăng nhập: đây là bản xem trước, không phải lỗi
      trackEvent("property_checked", { source: "preview" });
      return { result: local, source: "local", authRequired: true };
    }

    if (res.status === 429) {
      // Hết lượt hôm nay: đây đúng là thời điểm khách sẵn sàng nâng cấp.
      // Phải nói rõ, không được trả kết quả dự phòng như thể vẫn còn lượt.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      trackEvent("free_limit_reached", { source: "check_429" });
      return { result: local, source: "local", quotaExhausted: true, serverError: body.error };
    }

    if (!res.ok) {
      trackEvent("property_checked", { source: "local" });
      return { result: local, source: "local" };
    }

    const data: CheckApiResponse = await res.json();
    if (data.error || typeof data.investment_score !== "number") {
      trackEvent("property_checked", { source: "local" });
      return { result: local, source: "local" };
    }

    trackEvent("property_checked", { source: "ai" });
    return {
      result: fromApiResponse(data, local),
      source: "ai",
      analyzedAt: data.analyzed_at,
      checkId: typeof data.check_id === "string" ? data.check_id : null,
      seoSlug: typeof data.seo_slug === "string" ? data.seo_slug : null,
      confidence: typeof data.confidence === "number" ? data.confidence : null,
      cached: data.cached === true,
    };
  } catch {
    trackEvent("property_checked", { source: "local" });
    return { result: local, source: "local" };
  }
}

// Lấy quota thật của user từ server (chỉ gọi được khi đã đăng nhập).
// Dùng khi cần hiển thị/kiểm tra hạn mức mà không hardcode trong UI.
export async function fetchQuota(): Promise<QuotaInfo | null> {
  try {
    const res = await fetch("/api/check", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as QuotaInfo;
  } catch {
    return null;
  }
}
