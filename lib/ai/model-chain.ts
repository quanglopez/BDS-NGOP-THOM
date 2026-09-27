// Định tuyến model Pro Analysis — KHÔNG hardcode model trong business logic.
// Primary/fallback đến từ env. Chain tối đa MAX_CHAIN model, mỗi model tối đa
// 2 attempt (xem pro-analysis.ts) => không loop vô hạn.
//
// AUDIT CAPABILITY (đối chiếu OpenRouter /api/v1/models, supported_parameters):
// - qwen/qwen3.8-27b:free            -> structured_outputs ✔  => dùng JSON Schema
// - inclusionai/ling-3.0-flash-fin:free -> KHÔNG structured_outputs/response_format
//                                          => KHÔNG gửi response_format, prompt strict JSON
// - nvidia/nemotron-3.5-lightning:free   -> KHÔNG structured_outputs/response_format
//                                          => KHÔNG gửi response_format, prompt strict JSON
// Vì capability KHÁC NHAU, KHÔNG dùng native `models` array + route:'fallback'
// của OpenRouter (một body chung sẽ gửi param không model fallback chấp nhận).
// Thay bằng application-level chain có kiểm soát, mỗi model 1 body riêng.

import type { StructuredMode } from "./openrouter";

export const PRO_ANALYSIS_DEFAULT_MODEL = "qwen/qwen3.8-27b:free";
export const PRO_ANALYSIS_DEFAULT_FALLBACK_MODELS: readonly string[] = [
  "inclusionai/ling-3.0-flash-fin:free",
  "nvidia/nemotron-3.5-lightning:free",
];

// Chain tối đa: primary + 2 fallback. Không vượt quá để giữ latency có kiểm soát.
export const MAX_CHAIN = 3;

// Loại khỏi chain production: coding/agent, y tế, stealth, multimodal.
const DENIED_PATTERNS: RegExp[] = [
  /^poolside\//,                      // model chuyên coding
  /^cohere\/north-mini-code/,          // model chuyên coding
  /^inclusionai\/ling-3\.0-flash-sante/, // y tế, ngoài domain BĐS
  /^stealth\//,                        // preview, chưa ổn định
  /inkling/i,                          // chỉ chọn vì multimodal, pro-v1 không cần
  /omni/i,                             // Nemotron Nano Omni: multimodal, pro-v1 không cần
];

// Chỉ để benchmark nội bộ sau, KHÔNG đưa vào chain production.
export const PRO_ANALYSIS_BENCHMARK_CANDIDATES: readonly string[] = ["stealth/space-bunny-alpha"];

export function isDeniedModel(model: string): boolean {
  return DENIED_PATTERNS.some((re) => re.test(model));
}

// Chế độ structured output theo model (đã audit ở trên).
// Model lạ chưa biết -> json_object (mode rộng); nếu provider từ chối, pro-analysis
// hạ xuống "none" (prompt strict JSON) thay vì sập cả chain.
export function structuredModeFor(model: string): StructuredMode {
  const id = model.toLowerCase();
  if (id.startsWith("qwen/qwen3.8-27b")) return "json_schema";
  if (id.startsWith("inclusionai/ling-3.0-flash-fin")) return "none";
  if (id.startsWith("nvidia/nemotron-3.5-lightning")) return "none";
  return "json_object";
}

// Đọc chain từ env, lọc denied + trùng, cắt MAX_CHAIN.
// PRO_ANALYSIS_MODEL / PRO_ANALYSIS_FALLBACK_MODELS (phân tách bằng dấu phẩy).
export function resolveModelChain(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const primary = (env.PRO_ANALYSIS_MODEL || "").trim() || PRO_ANALYSIS_DEFAULT_MODEL;
  const rawFallbacks = (env.PRO_ANALYSIS_FALLBACK_MODELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fallbacks = rawFallbacks.length > 0 ? rawFallbacks : [...PRO_ANALYSIS_DEFAULT_FALLBACK_MODELS];

  const chain: string[] = [];
  for (const m of [primary, ...fallbacks]) {
    if (!m || isDeniedModel(m)) continue;
    if (!chain.includes(m)) chain.push(m);
    if (chain.length >= MAX_CHAIN) break;
  }
  return chain;
}
