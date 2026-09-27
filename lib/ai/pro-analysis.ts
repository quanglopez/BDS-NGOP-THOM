// generateProAnalysis(evidencePack): reusable entry duy nhất gọi OpenRouter.
// 1. validate evidence -> 2. build prompt -> 3. call -> 4. parse+validate ->
// 5. retry tối đa 1 lần nếu JSON hỏng -> 6. guard -> 7. fallback an toàn.
// AI fail KHÔNG bao giờ làm crash caller: luôn trả fallback deterministic.

import { callOpenRouter } from "./openrouter";
import { PRO_ANALYSIS_RETRY_INSTRUCTION, PRO_ANALYSIS_SYSTEM_PROMPT } from "./prompts";
import { parseProAnalysis, type ProAnalysis, type ProNextStep, type ProWarning } from "./schema";
import { guardProAnalysis } from "./guard";
import type { EvidencePack } from "./evidence";

export const PRO_ANALYSIS_VERSION_FALLBACK = "pro-v1";
export const SCORING_VERSION_FALLBACK = "jev-v1";

export interface ProAnalysisOutcome {
  analysis: ProAnalysis;
  // true khi AI fail và đã dùng fallback deterministic (UI hiện banner tương ứng)
  fromFallback: boolean;
  model: string;
  // Lý do fallback để log/debug (không chứa key)
  fallbackReason?: string;
}

// Fallback deterministic từ evidence thật — không gọi AI, không bịa thêm
export function buildFallbackAnalysis(evidence: EvidencePack): ProAnalysis {
  const p = evidence.property;
  const positives: ProAnalysis["score_explanation"]["strengths"] = [];
  const negatives: ProAnalysis["score_explanation"]["weaknesses"] = [];
  for (const c of evidence.scoring.contributions) {
    if (c.delta > 0) {
      positives.push({ title: c.label, explanation: c.note, evidence_source: "scoring" });
    } else if (c.delta < 0) {
      negatives.push({ title: c.label, explanation: c.note, evidence_source: "scoring" });
    }
  }

  const warnings: ProWarning[] = evidence.detected_signals.red_flags.map((r) => ({
    severity: "medium",
    title: r.signal,
    explanation: `${r.detail} Nên kiểm tra thêm.`,
    requires_verification: true,
    evidence_source: r.source,
  }));

  const nextSteps: ProNextStep[] = evidence.detected_signals.missing_fields.map((m) => ({
    priority: "medium",
    title: `Xác minh: ${m.signal}`,
    reason: m.detail,
  }));
  nextSteps.push({
    priority: "high",
    title: "Kiểm chứng sổ và quy hoạch",
    reason: "Mọi đánh giá trên đều suy từ nội dung tin đăng, cần xác minh trực tiếp.",
  });

  return {
    summary: {
      headline: `BĐS được ${evidence.scoring.overall_score}/100 điểm`,
      text: evidence.scoring.reasoning || "Chưa đủ dữ liệu để kết luận.",
      confidence: "low",
    },
    highlights: [],
    score_explanation: {
      summary: "Điểm các yếu tố dưới đây do mô hình CheckBDS chấm, không phải phép cộng trực tiếp tạo thành điểm tổng.",
      strengths: positives.slice(0, 5),
      weaknesses: negatives.slice(0, 5),
    },
    factor_analysis: [],
    price_analysis: {
      available: p.price !== null && p.area !== null,
      asking_price: p.price,
      price_per_m2: p.price_per_m2,
      reference_available: false,
      reference_median: null,
      difference_percent: null,
      explanation: "Chưa đủ dữ liệu tham chiếu để so sánh giá khu vực.",
    },
    warnings,
    next_steps: nextSteps.slice(0, 8),
    limitations: [
      "CheckBDS phân tích dựa trên nội dung tin đăng và các nguồn dữ liệu hiện có. Một số thông tin cần được xác minh trực tiếp với chủ sở hữu, cơ quan có thẩm quyền hoặc chuyên gia.",
    ],
  };
}

function resolveModel(): string {
  const fromEnv = (process.env.PRO_ANALYSIS_MODEL || "").trim();
  // Default đã xác minh tồn tại trên OpenRouter (bản stable, không preview).
  // Đổi model chỉ cần đổi env, không sửa business logic.
  return fromEnv || "google/gemini-2.5-flash";
}

export async function generateProAnalysis(evidence: EvidencePack): Promise<ProAnalysisOutcome> {
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  const model = resolveModel();

  // Chưa cấu hình key -> fallback ngay, không gọi mạng
  if (!apiKey) {
    return { analysis: buildFallbackAnalysis(evidence), fromFallback: true, model, fallbackReason: "no_api_key" };
  }

  const userPayload = JSON.stringify(evidence);

  const attempt = async (retryInstruction: string | null): Promise<ProAnalysis | null> => {
    const systemPrompt = retryInstruction
      ? `${PRO_ANALYSIS_SYSTEM_PROMPT}\n\n${retryInstruction}`
      : PRO_ANALYSIS_SYSTEM_PROMPT;
    const res = await callOpenRouter({
      apiKey,
      model,
      systemPrompt,
      userPayload,
      maxTokens: 1500,
      temperature: 0.2,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
      siteName: "CheckBDS",
    });
    if (!res.ok || !res.text) return null;
    const parsed = parseProAnalysis(res.text);
    if (!parsed) return null;
    const guard = guardProAnalysis(evidence, parsed);
    return guard.ok ? parsed : null;
  };

  // Lần 1
  const first = await attempt(null);
  if (first) return { analysis: first, fromFallback: false, model };

  // Retry tối đa 1 lần với instruction sửa JSON
  const second = await attempt(PRO_ANALYSIS_RETRY_INSTRUCTION);
  if (second) return { analysis: second, fromFallback: false, model };

  return {
    analysis: buildFallbackAnalysis(evidence),
    fromFallback: true,
    model,
    fallbackReason: "ai_invalid_or_failed",
  };
}
