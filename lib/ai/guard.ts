// Hallucination guard: kiểm tra output AI trước khi save.
// Mọi vi phạm -> reject (caller fallback). Không lưu analysis ảo giác.

import type { EvidencePack } from "./evidence";
import type { ProAnalysis } from "./schema";

// Cụm từ cấm: tuyệt đối không được xuất hiện dưới dạng khẳng định đã xác minh
const BANNED_VERIFIED_CLAIMS = [
  "pháp lý đã được xác minh",
  "pháp lý an toàn tuyệt đối",
  "khu vực này bị ngập",
  "quy hoạch đã được xác nhận",
  "giá giao dịch thực tế",
  "giá thị trường chính xác",
  "chắc chắn sinh lời",
  "khoản đầu tư tốt",
];

const BANNED_ADVICE = ["bạn nên mua", "chắc chắn sinh lời", "đây là khoản đầu tư tốt"];

export interface GuardResult {
  ok: boolean;
  reasons: string[];
}

function textOf(a: ProAnalysis): string {
  const parts: string[] = [
    a.summary.headline,
    a.summary.text,
    a.score_explanation.summary,
    ...a.highlights.map((h) => `${h.title} ${h.explanation}`),
    ...a.score_explanation.strengths.map((s) => `${s.title} ${s.explanation}`),
    ...a.score_explanation.weaknesses.map((s) => `${s.title} ${s.explanation}`),
    ...a.factor_analysis.map((f) => `${f.factor} ${f.explanation}`),
    a.price_analysis.explanation,
    ...a.warnings.map((w) => `${w.title} ${w.explanation}`),
    ...a.next_steps.map((n) => `${n.title} ${n.reason}`),
    ...a.limitations,
  ];
  return parts.join("\n").toLowerCase();
}

export function guardProAnalysis(evidence: EvidencePack, analysis: ProAnalysis): GuardResult {
  const reasons: string[] = [];
  const text = textOf(analysis);

  // 1. Score / price / area AI không được thay đổi (AI chỉ giải thích, không chấm lại)
  // Guard này áp dụng ở tầng parse số trong price_analysis (backend đã tính).
  const pa = analysis.price_analysis;
  if (pa.available) {
    const expectedPpm2 = evidence.property.price_per_m2;
    if (expectedPpm2 !== null && pa.price_per_m2 !== null && pa.price_per_m2 !== expectedPpm2) {
      reasons.push("price_per_m2 không khớp backend");
    }
    if (evidence.property.price !== null && pa.asking_price !== null && pa.asking_price !== evidence.property.price) {
      reasons.push("asking_price không khớp backend");
    }
  }

  // 2. Reference/comparables chỉ tồn tại nếu Evidence Pack có
  if (pa.reference_available || pa.reference_median !== null || pa.difference_percent !== null) {
    reasons.push("khai báo reference price trong khi evidence không có dữ liệu tham chiếu");
  }

  // 3. Claim pháp lý/quy hoạch đã xác minh khi không có verified source
  for (const claim of BANNED_VERIFIED_CLAIMS) {
    if (text.includes(claim)) {
      reasons.push(`claim đã xác minh không có nguồn: "${claim}"`);
      break;
    }
  }

  // 4. Lời khuyên đầu tư chắc nịch
  for (const advice of BANNED_ADVICE) {
    if (text.includes(advice)) {
      reasons.push(`khuyên đầu tư chắc nịch: "${advice}"`);
      break;
    }
  }

  return { ok: reasons.length === 0, reasons };
}
