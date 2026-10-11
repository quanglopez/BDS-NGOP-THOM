// Deal Grader (PHASE 3) — ánh xạ kết quả gọi AI sang trạng thái UI.
//
// Tách khỏi `preview.ts` có chủ ý: `preview.ts` là đường deterministic thuần
// (không mạng, không AI), còn file này là biên giới với đường AI. Tách ra để
// test khẳng định được "bản chấm nhanh không hề biết tới AI" ở mức module,
// thay vì chỉ dựa vào việc đọc chuỗi trong file.

/**
 * Hình dạng tối thiểu của kết quả runCheck() mà Deal Grader cần. Khai báo
 * cấu trúc thay vì import CheckOutcome để không kéo lib/client-check vào
 * những chỗ chỉ cần phân loại trạng thái.
 */
export interface DealAiOutcomeLike {
  source: "ai" | "local";
  authRequired?: boolean;
  quotaExhausted?: boolean;
  serverError?: string;
  checkId?: string | null;
  seoSlug?: string | null;
  cached?: boolean;
  confidence?: number | null;
}

export type DealAiState =
  | {
      kind: "success";
      checkId: string | null;
      seoSlug: string | null;
      cached: boolean;
      confidence: number | null;
    }
  | { kind: "auth_required" }
  | { kind: "quota_exhausted"; message: string }
  | { kind: "unavailable"; message: string };

export const AI_UNAVAILABLE_MESSAGE = "AI đang bận, vui lòng thử lại sau ít phút.";
export const QUOTA_EXHAUSTED_FALLBACK_MESSAGE = "Bạn đã hết lượt chấm bằng AI hôm nay.";

/**
 * Ánh xạ kết quả gọi /api/check sang trạng thái UI. Không tự đoán: `source`
 * chỉ là "ai" khi server THẬT SỰ trả điểm AI. Mọi nhánh còn lại giữ nguyên
 * bản chấm nhanh đang hiển thị và KHÔNG bịa điểm AI.
 *
 * Thứ tự kiểm tra quan trọng: 429 quota đứng trước 401, vì runCheck trả
 * `quotaExhausted` cho 429 và UI phải nói rõ hết lượt thay vì mời đăng nhập.
 */
export function classifyAiOutcome(outcome: DealAiOutcomeLike): DealAiState {
  if (outcome.quotaExhausted) {
    return {
      kind: "quota_exhausted",
      message: outcome.serverError ?? QUOTA_EXHAUSTED_FALLBACK_MESSAGE,
    };
  }
  if (outcome.authRequired) {
    return { kind: "auth_required" };
  }
  if (outcome.source === "ai") {
    return {
      kind: "success",
      checkId: outcome.checkId ?? null,
      seoSlug: outcome.seoSlug ?? null,
      cached: outcome.cached === true,
      confidence:
        typeof outcome.confidence === "number" && Number.isFinite(outcome.confidence)
          ? outcome.confidence
          : null,
    };
  }
  // source "local" sau khi người dùng CỐ Ý bấm "Chấm bằng AI" nghĩa là đường AI
  // không chạy được (thiếu key / provider lỗi / mạng). Không được coi là kết quả AI.
  return { kind: "unavailable", message: AI_UNAVAILABLE_MESSAGE };
}
