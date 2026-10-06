// Cache read-through cho luồng Check thủ công: cùng canonical request + cùng
// SCORING_CODE_VERSION = reuse score đã chấm, KHÔNG gọi lại Jev.
// Key KHÔNG gồm user_id ở phần canonical (đầu vào chấm điểm giống nhau giữa
// các user); quyền sở hữu ép ở tầng query + unique index (user_id, key) —
// xem migration 0023. Hit = pure read, không insert, không trừ quota.
import { CHECK_QUESTIONS, sha256Hex } from "@/lib/ai/jev-check";
import { SCORING_CODE_VERSION } from "@/lib/scoring";

/** Canonical request gửi Jev — định nghĩa ở một chỗ để cache key luôn khớp body. */
export function canonicalJevRequest(state: string) {
  return { model: "jev-latest", state, questions: CHECK_QUESTIONS };
}

/** SHA-256(JSON(canonical request) + scoring_code_version). Đổi cách nối
 *  chuỗi ở đây sẽ lệch key — mọi luồng phải dùng chung hàm này. */
export async function scoringCacheKey(state: string): Promise<string> {
  return sha256Hex(JSON.stringify(canonicalJevRequest(state)) + SCORING_CODE_VERSION);
}
