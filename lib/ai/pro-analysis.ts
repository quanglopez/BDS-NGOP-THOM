// generateProAnalysis(evidencePack): reusable entry duy nhất gọi OpenRouter.
// Chain model có kiểm soát (mỗi model tối đa 2 attempt, chain tối đa 3 model):
//   Evidence -> model[0] -> parse -> validate -> guard
//   -> fail thì model[1] -> ... -> deterministic fallback.
// AI fail KHÔNG bao giờ làm crash caller: luôn trả fallback deterministic.

import { callOpenRouter, type StructuredMode } from "./openrouter";
import {
  PRO_ANALYSIS_RETRY_INSTRUCTION,
  PRO_ANALYSIS_STRICT_JSON_INSTRUCTION,
  PRO_ANALYSIS_SYSTEM_PROMPT,
} from "./prompts";
import {
  parseProAnalysisDetailed,
  type ProAnalysis,
  type ProNextStep,
  type ProWarning,
} from "./schema";
import { PRO_ANALYSIS_JSON_SCHEMA, PRO_ANALYSIS_JSON_SCHEMA_NAME } from "./json-schema";
import { guardProAnalysis } from "./guard";
import { calcPricePerM2 } from "./evidence";
import { reasoningConfigFor, resolveModelChain, structuredModeFor, timeoutMsFor } from "./model-chain";
import { askProRoute, defaultRoute, formatJevDecisionReceipt, type ProFailureKind } from "./jev-decision";
import type { EvidencePack } from "./evidence";

export const PRO_ANALYSIS_VERSION_FALLBACK = "pro-v1";
// KHÔNG có SCORING_VERSION fallback ở đây: version scoring đến từ constant
// SCORING_CODE_VERSION trong lib/scoring.ts, đi cùng công thức chấm điểm.

// Mỗi model tối đa 2 request: attempt 1 theo capability, attempt 2 là recovery
// (hạ structured output xuống prompt-only, hoặc ép sửa JSON). Không loop vô hạn.
const MAX_ATTEMPTS_PER_MODEL = 2;
// Ngân sách output cho 1 lần gọi. 1500 làm Ling bị cắt giữa chừng
// (finish_reason=length) -> JSON dở -> không validate được.
//
// Lưu ý: ngân sách này CHỈ còn ý nghĩa sau khi đã tắt reasoning cho model
// reasoning-on (xem reasoningConfigFor ở model-chain.ts). Reasoning token
// tính vào max_tokens, nên nếu để bật, 3000 token bị suy luận ăn hết và
// content về rỗng — tăng con số này cũng không sửa được, chỉ tăng chi phí.
export const MAX_OUTPUT_TOKENS = 3000;

// Attempt SAU một lần bị CẮT (finish_reason=length) thì cấp thêm ngân sách
// thay vì lặp lại y hệt. Đây là fix cho lỗi production
// provider_truncated: nguyên nhân là "hết max_tokens", nên gửi lại đúng
// max_tokens cũ + đúng prompt cũ chắc chắn cắt lại — attempt 2 luôn lãng phí
// ~8-17s rồi vẫn fail. Evidence 2026-09-30 (11 provider_truncated / 5 user):
// DeepSeek trả cắt ở CẢ HAI attempt với output đúng 3000 = max_tokens.
//
// Tăng có trần, không phải lặp vô hạn: MAX_ATTEMPTS_PER_MODEL vẫn = 2, và
// chainBudgetMs vẫn chặn tổng thời gian nên attempt 2 không thể kéo dài quá
// budget. Nếu vẫn cắt, Jev đổi model — chain luôn kết thúc.
export const MAX_OUTPUT_TOKENS_RETRY = 6000;

// Ngân sách TỔNG cho cả chain (mọi model, mọi attempt, mọi lần hỏi Jev).
//
// Route khai `maxDuration = 60`. Trước đây KHÔNG có budget nào ở đây:
// mỗi attempt dùng timeout riêng của model (15s mặc định, 30s cho Ling VL và
// Qwen trả phí), 3 model x 2 attempt cộng lại có thể 120s provider + 15s Jev
// = 135s > 60s -> Vercel Runtime Timeout, user mất trắng cả request.
// Đây là lỗi production đã ghi nhận (5 occurrence / 2 user).
//
// Số này là TỔNG cho tới khi hết, không phải trần mỗi lần gọi. Phần còn lại
// (60 - 42 = 18s) dành cho auth + đọc DB + save snapshot sau khi chain xong.
export const DEFAULT_CHAIN_BUDGET_MS = 42000;

// Không mở lần gọi mới nếu phần còn lại nhỏ hơn ngưỡng này: một request cần
// thời gian tối thiểu để trả kết quả, mở ra chỉ để bị cắt giữa chừng thì
// tệ hơn là dừng luôn và trả fallback deterministic.
export const MIN_CALL_BUDGET_MS = 3000;

/** Đọc budget từ env; thiếu/sai thì dùng mặc định. Cho phép override để test. */
export function chainBudgetMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.PRO_ANALYSIS_CHAIN_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CHAIN_BUDGET_MS;
}

export interface ProAnalysisMetrics {
  requested_model: string;
  actual_model: string | null;
  fallback_used: boolean;
  attempts: number;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  provider_errors: string[];
  rate_limited: boolean;
  validation_failed: boolean;
  guard_failed: boolean;
  // Chain dừng vì hết budget trước khi thử hết model. true = còn model trong
  // chain chưa thử, nhưng đã hết thời gian -> báo cáo deterministic là kết quả
  // bị giới hạn bởi deadline, KHÔNG phải vì model hỏng hẳn.
  budget_exhausted: boolean;
}

export interface ProAnalysisOutcome {
  analysis: ProAnalysis;
  // true khi AI fail và đã dùng fallback deterministic (UI hiện banner tương ứng)
  fromFallback: boolean;
  // Model THỰC TẾ đã sinh ra analysis (từ response.model của provider).
  // null khi rơi về deterministic fallback.
  model: string | null;
  // Model đầu tiên được yêu cầu — chỉ để trace/log, KHÔNG lưu vào ai_model.
  requestedModel: string;
  // Lý do fallback để log/debug (không chứa key)
  fallbackReason?: string;
  metrics: ProAnalysisMetrics;
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

  // 3 điểm đáng chú ý DETERMINISTIC — để Pro user ở chế độ fallback vẫn thấy
  // giá trị, không cảm thấy "Pro y như Free".
  // Chỉ lấy từ evidence đã chấm, KHÔNG suy diễn thêm.
  const candidates: ProAnalysis["highlights"] = [];
  for (const c of positives) {
    candidates.push({ type: "positive", title: c.title, explanation: c.explanation, evidence_source: "scoring" });
  }
  for (const c of negatives) {
    candidates.push({ type: "warning", title: c.title, explanation: c.explanation, evidence_source: "scoring" });
  }
  for (const r of evidence.detected_signals.red_flags) {
    candidates.push({
      type: "warning",
      title: `Cần kiểm tra: ${r.signal}`,
      explanation: r.detail,
      evidence_source: r.source,
    });
  }
  if (p.price !== null && p.area !== null) {
    candidates.push({
      type: "neutral",
      title: `Giá/m² tính từ tin: ${calcPricePerM2(p.price, p.area)?.toLocaleString("vi-VN")} đ/m²`,
      explanation:
        "Đây là phép tính trên giá chào bán và diện tích trong tin, chưa so với mặt bằng khu vực.",
      evidence_source: "calculated",
    });
  } else {
    candidates.push({
      type: "warning",
      title: "Thiếu giá hoặc diện tích",
      explanation: `Cần bổ sung ${evidence.detected_signals.missing_fields.map((m) => m.signal).join(", ")} để tính được giá/m².`,
      evidence_source: "missing",
    });
  }

  // Ưu tiên 1 tích cực + 1 cần lưu ý + 1 giá/m², phần dư lấp cho đủ 3.
  // KHÔNG bịa điểm "cần lưu ý" khi evidence thật sự không có tín hiệu xấu.
  const firstPositive = candidates.find((h) => h.type === "positive");
  const firstWarning = candidates.find((h) => h.type === "warning");
  const neutral = candidates.find((h) => h.type === "neutral");
  const highlights = [
    ...(firstPositive ? [firstPositive] : []),
    ...(firstWarning && firstWarning !== firstPositive ? [firstWarning] : []),
    ...(neutral ? [neutral] : []),
    ...candidates.filter((h) => h !== firstPositive && h !== firstWarning && h !== neutral),
  ].slice(0, 3);

  return {
    summary: {
      headline: `BĐS được ${evidence.scoring.overall_score}/100 điểm`,
      text: evidence.scoring.reasoning || "Chưa đủ dữ liệu để kết luận.",
      confidence: "low",
    },
    highlights,
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

// Log metric server-side: KHÔNG prompt, KHÔNG API key, KHÔNG PII.
export function formatProAnalysisMetrics(m: ProAnalysisMetrics): string {
  return [
    `requested_model=${m.requested_model}`,
    `actual_model=${m.actual_model ?? "-"}`,
    `fallback_used=${m.fallback_used}`,
    `attempts=${m.attempts}`,
    `latency_ms=${m.latency_ms}`,
    `success=${!m.fallback_used}`,
    `validation_failed=${m.validation_failed}`,
    `guard_failed=${m.guard_failed}`,
    `budget_exhausted=${m.budget_exhausted}`,
    `rate_limited=${m.rate_limited}`,
    `provider_error=${m.provider_errors.length > 0 ? m.provider_errors.join("|") : "-"}`,
    `input_tokens=${m.input_tokens ?? "-"}`,
    `output_tokens=${m.output_tokens ?? "-"}`,
  ].join(" ");
}

function baseSystemPrompt(mode: StructuredMode, retry: boolean): string {
  // Model không hỗ trợ response_format -> ép strict JSON bằng prompt.
  const base =
    mode === "none" ? `${PRO_ANALYSIS_SYSTEM_PROMPT}\n\n${PRO_ANALYSIS_STRICT_JSON_INSTRUCTION}` : PRO_ANALYSIS_SYSTEM_PROMPT;
  return retry ? `${base}\n\n${PRO_ANALYSIS_RETRY_INSTRUCTION}` : base;
}

export async function generateProAnalysis(evidence: EvidencePack): Promise<ProAnalysisOutcome> {
  const chain = resolveModelChain();
  const metrics: ProAnalysisMetrics = {
    requested_model: chain[0] ?? "none",
    actual_model: null,
    fallback_used: true,
    attempts: 0,
    latency_ms: 0,
    input_tokens: null,
    output_tokens: null,
    provider_errors: [],
    rate_limited: false,
    validation_failed: false,
    guard_failed: false,
    budget_exhausted: false,
  };

  const finishFallback = (reason: string): ProAnalysisOutcome => {
    metrics.fallback_used = true;
    return {
      analysis: buildFallbackAnalysis(evidence),
      fromFallback: true,
      model: null,
      requestedModel: metrics.requested_model,
      fallbackReason: reason,
      metrics,
    };
  };

  const apiKey = process.env.OPENROUTER_API_KEY || "";
  // Chưa cấu hình key -> fallback ngay, không gọi mạng
  if (!apiKey) return finishFallback("no_api_key");

  const userPayload = JSON.stringify(evidence);
  const startedAt = Date.now();
  const budgetMs = chainBudgetMs();
  // Đã gặp provider_truncated ở attempt trước của model này -> attempt sau
  // cấp thêm token. Chỉ bật trong chain, mỗi model tự reset khi đổi model.
  let escalateTokens = false;

  // Lich su fail cua chain - input cho quyet dinh Jev. KHONG chua PII.
  const priorModels: string[] = [];
  const priorFailures: ProFailureKind[] = [];

  /**
   * Hoi Jev buoc tiep theo sau 1 lan fail.
   * Tra "continue" = thu lai attempt nay, "next_model" = bo qua model nay,
   * "fallback" = dung luon, tra report deterministic.
   * Loi Jev -> ve duong danh co dinh (retry het attempt truoc het).
   */
  const routeAfterFailure = async (
    model: string,
    modelIndex: number,
    attempt: number,
    failure: ProFailureKind,
    guardReasons: string[],
  ): Promise<"continue" | "next_model" | "fallback"> => {
    // Hết budget -> KHÔNG hỏi Jev. Một lượt hỏi tốn tới 2,5s, và ngay sau đó
    // vòng loop sẽ chạm ngưỡng budget rồi dừng, nên hỏi chỉ tốn thêm thời gian
    // cho một quyết định không ai dùng. Đi đường cố định — giống hệt hành vi
    // khi JEV_DECISION=off, để rollout không đổi thứ tự quyết định.
    if (budgetMs - (Date.now() - startedAt) < MIN_CALL_BUDGET_MS) {
      const decision = defaultRoute({
        attempt,
        modelIndex,
        model,
        failure,
        priorModels: [...priorModels],
        priorFailures: [...priorFailures],
        guardReasons,
        modelsRemaining: chain.length - modelIndex - 1,
      });
      console.log(
        `[pro-analysis-jev] contract=pro-analysis-route mode=skipped route=${decision} ` +
          `used_jev=false confidence=- model=- latency_ms=0 input_tokens=- output_tokens=- reason=budget_exhausted`,
      );
      if (decision === "deterministic_fallback") return "fallback";
      if (decision === "switch_model") return "next_model";
      return "continue";
    }

    const receipt = await askProRoute({
      attempt,
      modelIndex,
      model,
      failure,
      priorModels: [...priorModels],
      priorFailures: [...priorFailures],
      guardReasons,
      modelsRemaining: chain.length - modelIndex - 1,
    });
    console.log(`[pro-analysis-jev] ${formatJevDecisionReceipt(receipt)}`);
    if (receipt.route === "deterministic_fallback") return "fallback";
    if (receipt.route === "switch_model") return "next_model";
    return "continue";
  };

  for (let mi = 0; mi < chain.length; mi++) {
    const model = chain[mi];
    let mode = structuredModeFor(model);
    const fallbackModel = chain[mi + 1] ?? "-";
    // Mỗi model tự quyết định ngân sách riêng: model mới không kế thừa việc
    // tăng token của model trước.
    escalateTokens = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
      const isRetry = attempt > 0;

      // Chặn TRƯỚC khi mở request mới: không đủ budget thì dừng luôn và trả
      // fallback deterministic, thay vì mở thêm một call chắc chắn bị cắt.
      const remainingMs = budgetMs - (Date.now() - startedAt);
      if (remainingMs < MIN_CALL_BUDGET_MS) {
        metrics.provider_errors.push("chain_budget_exhausted");
        metrics.budget_exhausted = true;
        return finishFallback("chain_budget_exhausted");
      }
      // Clamp deadline của call này vào phần còn lại của budget chung.
      const callTimeoutMs = Math.min(timeoutMsFor(model), remainingMs);

      const res = await callOpenRouter({
        apiKey,
        model,
        systemPrompt: baseSystemPrompt(mode, isRetry),
        userPayload,
        maxTokens: escalateTokens ? MAX_OUTPUT_TOKENS_RETRY : MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
        siteName: "CheckBDS",
        structuredMode: mode,
        jsonSchema:
          mode === "json_schema"
            ? { name: PRO_ANALYSIS_JSON_SCHEMA_NAME, strict: false, schema: PRO_ANALYSIS_JSON_SCHEMA }
            : undefined,
        timeoutMs: callTimeoutMs,
        // Trần TỔNG của call: idle deadline có thể bị re-arm vô hạn khi provider
        // nhỏ giọt, nên phải có thời điểm tuyệt đối để chặn.
        totalTimeoutMs: remainingMs,
        reasoning: reasoningConfigFor(model),
      });

      metrics.attempts += 1;
      metrics.latency_ms += res.latencyMs;
      if (res.usage.promptTokens !== null) metrics.input_tokens = (metrics.input_tokens ?? 0) + res.usage.promptTokens;
      if (res.usage.completionTokens !== null) {
        metrics.output_tokens = (metrics.output_tokens ?? 0) + res.usage.completionTokens;
      }

      if (res.error === "provider_429") metrics.rate_limited = true;
      if (res.error) metrics.provider_errors.push(res.error);

      // Log chi tiết MỖI lần lỗi để chẩn đoán Case A-F.
      // KHÔNG log: API key, prompt, PII (đã sanitize trong openrouter.ts).
      if (res.error) {
        console.error(
          `[pro-analysis-error] provider_error=${res.error} http_status=${res.status ?? "-"} ` +
            `requested_model=${model} actual_model=${res.actualModel ?? "-"} ` +
            `fallback_attempt=${attempt + 1} fallback_model=${fallbackModel} ` +
            `structured_mode=${mode} finish_reason=${res.finishReason ?? "-"} ` +
            `timeout_ms=${callTimeoutMs} model_timeout_ms=${timeoutMsFor(model)} ` +
            `chain_budget_ms=${budgetMs} chain_elapsed_ms=${Date.now() - startedAt} ` +
            `max_tokens=${escalateTokens ? MAX_OUTPUT_TOKENS_RETRY : MAX_OUTPUT_TOKENS} ` +
            `latency_ms=${res.latencyMs} response_body_safe=${res.errorMessage ?? "-"}`,
        );
      }

      // 429 KHÔNG phải lỗi nội dung: provider đã từ chối hết quota cho key
      // này. Gọi lại cùng model sau ~100ms chỉ để nhận 429 lần nữa, mỗi lần
      // lại tiêu quota mà request hợp lệ sau có thể dùng. (Đo production
      // 2026-09-30: 4 provider call / 1 user request, tất cả 429.)
      // -> Ghi nhận rate limit rồi đổi model ngay, KHÔNG hỏi Jev: hỏi ở đây
      // chỉ cho phép trả về "thử lại model này", tức là quay lại 429.
      if (res.error === "provider_429") {
        metrics.rate_limited = true;
        priorModels.push(model);
        priorFailures.push("provider_429");
        if (mi >= chain.length - 1) return finishFallback("all_models_rate_limited");
        break;
      }

      // Provider từ chối param structured output -> hạ xuống prompt-only
      // rồi thử lại model này (thay vì làm hỏng cả fallback chain).
      // Đây là lỗi CẤU HÌNH, không phải lỗi nội dung -> không hỏi Jev.
      if (res.error === "provider_unsupported_param" && mode !== "none") {
        mode = "none";
        continue;
      }

      if (!res.ok || !res.text) {
        // Đã cắt vì hết max_tokens -> attempt sau của CÙNG model cấp thêm ngân
        // sách. Không làm thế cho lỗi khác: 429/timeout/network hết token cũng
        // vô ích, và tăng budget chỉ làm latency nặng thêm.
        if (res.error === "provider_truncated") escalateTokens = true;
        const go = await routeAfterFailure(model, mi, attempt + 1, (res.error ?? "provider_error") as ProFailureKind, []);
        priorModels.push(model);
        priorFailures.push((res.error ?? "provider_error") as ProFailureKind);
        if (go === "fallback") {
          const allRateLimitedSoFar = metrics.rate_limited && metrics.provider_errors.every((e) => e === "provider_429");
          return finishFallback(allRateLimitedSoFar ? "all_models_rate_limited" : "all_models_failed");
        }
        if (go === "next_model") break;
        continue;
      }

      const parsed = parseProAnalysisDetailed(res.text);
      if (!parsed.ok) {
        metrics.validation_failed = true;
        console.error(
          `[pro-analysis-error] provider_error=validation_failed http_status=${res.status ?? 200} ` +
            `requested_model=${model} actual_model=${res.actualModel ?? "-"} ` +
            `fallback_attempt=${attempt + 1} fallback_model=${fallbackModel} ` +
            `structured_mode=${mode} finish_reason=${res.finishReason ?? "-"} ` +
            `latency_ms=${res.latencyMs} parse_reason=${parsed.reason} ` +
            `response_body_safe=parse_failed:${parsed.detail} ` +
            `top_keys=${parsed.topKeys.join(",") || "-"} text_len=${res.text.length}`,
        );
        const go = await routeAfterFailure(model, mi, attempt + 1, "validation_failed", []);
        priorModels.push(model);
        priorFailures.push("validation_failed");
        if (go === "fallback") return finishFallback("all_models_failed");
        if (go === "next_model") break;
        continue;
      }
      const analysis = parsed.analysis;

      const guard = guardProAnalysis(evidence, analysis);
      if (!guard.ok) {
        metrics.guard_failed = true;
        console.error(
          `[pro-analysis-error] provider_error=guard_rejected http_status=${res.status ?? 200} ` +
            `requested_model=${model} actual_model=${res.actualModel ?? "-"} ` +
            `fallback_attempt=${attempt + 1} fallback_model=${fallbackModel} ` +
            `structured_mode=${mode} finish_reason=${res.finishReason ?? "-"} ` +
            `latency_ms=${res.latencyMs} response_body_safe=${guard.reasons.join(" | ").slice(0, 200)}`,
        );
        // BIẢ DAI: guard reject thường lặp lại y hệt ở attempt 2 -> tốn 1 lần
        // gọi model (~vài nghìn token) để nhận ra điều đã biết. Đây là chỗ Jev
        // tiết kiệm rõ nhất: đổi model ngay thay vì lặp lại.
        //
        // THỨ TỰ QUAN TRỌNG: hỏi Jev TRƯỚC khi push lỗi hiện tại vào lịch sử.
        // `priorFailures` phải nghĩa là "các lần đã hỏng TRƯỚC attempt này".
        // Nếu push trước, state nói "lỗi này đã lặp" ngay lần đầu -> model đổi
        // sớm, bỏ mất attempt 2 vốn để cứu lỗi ngẫu nhiên. (Đã bắt được bằng
        // npm run jev:bench — 2/6 kịch bản bị hỏng thêm trước khi sửa.)
        const go = await routeAfterFailure(model, mi, attempt + 1, "guard_failed", guard.reasons);
        priorModels.push(model);
        priorFailures.push("guard_failed");
        if (go === "fallback") return finishFallback("all_models_failed");
        if (go === "next_model") break;
        continue;
      }

      // Model thực tế đã trả lời (response.model), ưu tiên hơn model yêu cầu.
      const actualModel = res.actualModel ?? model;
      metrics.actual_model = actualModel;
      metrics.fallback_used = false;
      metrics.latency_ms = Date.now() - startedAt;
      return {
        analysis,
        fromFallback: false,
        model: actualModel,
        requestedModel: metrics.requested_model,
        metrics,
      };
    }
  }

  // Cả chain fail -> deterministic fallback. Lý do phân loại để đo tỉ lệ lỗi.
  const allRateLimited = metrics.rate_limited && metrics.provider_errors.every((e) => e === "provider_429");
  return finishFallback(allRateLimited ? "all_models_rate_limited" : "all_models_failed");
}
