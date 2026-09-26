import { analyzeListing, fromApiResponse } from "@/lib/scoring";
import type { AnalysisResult, CheckApiResponse } from "@/lib/types";
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
}

// Thông tin người đăng kèm theo khi check (có từ quét danh mục / link tin)
export interface ContactInfo {
  contactName?: string | null;
  phone?: string | null;
  listingUrl?: string | null;
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
    return { result: fromApiResponse(data, local), source: "ai", analyzedAt: data.analyzed_at };
  } catch {
    trackEvent("property_checked", { source: "local" });
    return { result: local, source: "local" };
  }
}
