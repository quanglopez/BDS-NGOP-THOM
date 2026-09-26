import { analyzeListing, fromApiResponse } from "@/lib/scoring";
import type { AnalysisResult, CheckApiResponse } from "@/lib/types";

export type CheckSource = "ai" | "local";

export interface CheckOutcome {
  result: AnalysisResult;
  source: CheckSource;
  // Thời điểm server trả kết quả (ISO) - dùng để hiển thị, không phải đồng hồ client
  analyzedAt?: string;
}

// Thông tin người đăng kèm theo khi check (có từ quét danh mục / link tin)
export interface ContactInfo {
  contactName?: string | null;
  phone?: string | null;
  listingUrl?: string | null;
}

// Gọi /api/check; nếu server thiếu key hoặc AI lỗi thì fallback scoring local để demo luôn chạy được
export async function runCheck(text: string, contact?: ContactInfo): Promise<CheckOutcome> {
  const local = analyzeListing(text);

  try {
    const res = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, ...(contact ?? {}) }),
    });

    if (!res.ok) return { result: local, source: "local" };

    const data: CheckApiResponse = await res.json();
    if (data.error || typeof data.investment_score !== "number") {
      return { result: local, source: "local" };
    }

    return { result: fromApiResponse(data, local), source: "ai", analyzedAt: data.analyzed_at };
  } catch {
    return { result: local, source: "local" };
  }
}
