// Định tuyến model Pro Analysis — KHÔNG hardcode model trong business logic.
// Primary/fallback đến từ env. Chain tối đa MAX_CHAIN model, mỗi model tối đa
// 2 attempt (xem pro-analysis.ts) => không loop vô hạn.
//
// AUDIT CAPABILITY (đối chiếu OpenRouter /api/v1/models, supported_parameters):
// - qwen/qwen3.8-27b:free            -> structured_outputs ✔  => dùng JSON Schema
// - google/gemma-4-31b-it:free        -> response_format ✔, KHÔNG structured_outputs
//                                          => dùng json_object
// - nvidia/nemotron-3.5-lightning:free   -> KHÔNG structured_outputs/response_format
//                                          => KHÔNG gửi response_format, prompt strict JSON
// - inclusionai/ling-3.0-flash-vl    -> structured_outputs ✔ + response_format ✔
//                                          => dùng JSON Schema
//   (đã đối chiếu GET openrouter.ai/api/v1/models ngày 2026-09-30:
//    supported_parameters gồm structured_outputs, context_length 262144)
// Vì capability KHÁC NHAU, KHÔNG dùng native `models` array + route:'fallback'
// của OpenRouter (một body chung sẽ gửi param không model fallback chấp nhận).
// Thay bằng application-level chain có kiểm soát, mỗi model 1 body riêng.

import type { StructuredMode } from "./openrouter";

// Timeout mặc định, PHẢI bằng DEFAULT_TIMEOUT_MS ở lib/ai/openrouter.ts:10.
// Lặp giá trị thay vì import vì model-chain không được phụ thuộc runtime
// client; đổi một trong hai thì cả hai phải đổi theo (xem timeoutMsFor).
const DEFAULT_TIMEOUT_MS = 15000;

// Timeout riêng cho model CHẬM. Số ở đây là deadline của HTTP request
// tới provider, không phải của cả chain.
//
// Ling VL là model vision-language: phải route qua provider có cold
// start, nên 15s mặc định bị abort giữa chừng. Đo production 2026-09-30
// 11:05 (check adc166ee): Qwen 429 sau 165ms, rồi
// requested_model=inclusionai/ling-3.0-flash-vl -> provider_timeout tại
// latency_ms=15003 — đúng trần 15s, http_status=-, response_body_safe=-
// => KHÔNG phải provider từ chối, mà client tự huỷ trước khi provider
// kịp trả lời.
//
// Suy ra từ một mẫu, không phải kết luận: 30s chỉ là mức nới để phân biệt
// "model chậm" với "model hỏng". Nếu sau khi nới vẫn provider_timeout ở
// ~30s thì vấn đề không nằm ở deadline.
//
// Mẫu thứ hai, slug TRẢ PHÍ (đo 2026-09-30 11:28, check 103a3f9c):
// Qwen free 429, rồi requested_model=qwen/qwen3.8-27b ->
// provider_timeout tại latency_ms=15002, timeout_ms=15000, http_status=-,
// response_body_safe=-. Ba slug khác nhau (Qwen free, Ling VL, Qwen paid)
// đều im lặng, đều không có body => im lặng ở tầng transport, không phải
// do tham số request.
//
// Regex PHẢI neo cuối. `^qwen/qwen3\.8-27b` không có `$` sẽ khớp cả
// "qwen/qwen3.8-27b:free" và đổi deadline của slug free — thứ không được
// nới, vì free đã trả 429 nhanh (165ms), không cần thêm thời gian.
const MODEL_TIMEOUT_MS: readonly (readonly [RegExp, number])[] = [
  [/^inclusionai\/ling-3\.0-flash-vl/, 30000],
  [/^qwen\/qwen3\.8-27b$/, 30000],
];

// Deadline cho 1 request tới `model`. Model không khai báo -> default.
export function timeoutMsFor(model: string): number {
  for (const [re, ms] of MODEL_TIMEOUT_MS) {
    if (re.test(model)) return ms;
  }
  return DEFAULT_TIMEOUT_MS;
}

export const PRO_ANALYSIS_DEFAULT_MODEL = "qwen/qwen3.8-27b:free";
// Chain v1 (production): Qwen -> Gemma -> deterministic fallback.
// Nemotron 3.5 Lightning bị loại khỏi v1: timeout 15s làm hỏng UX, Evidence Pack
// chỉ vài KB nên không cần model 1M context. Xem V1_EXCLUDED_MODELS bên dưới.
export const PRO_ANALYSIS_DEFAULT_FALLBACK_MODELS: readonly string[] = [
  "google/gemma-4-31b-it:free",
];

// Slug OpenRouter đã RÚT (không còn trong /api/v1/models) -> mọi request trả
// 404 "This model is unavailable for free" và đốt 2 attempt của chain vô ích.
// Lọc ở CODE chứ không chỉ sửa default: env production đã có
// PRO_ANALYSIS_FALLBACK_MODELS, nên nếu chỉ đổi default thì production vẫn
// chạy slug chết. Muốn mở lại model: xoá khỏi set này.
const RETIRED_MODELS: RegExp[] = [
  /^inclusionai\/ling-3\.0-flash-fin/, // OpenRouter đã bỏ, chỉ còn bản -sante (y tế)
];

// Loại khỏi chain production v1, kể cả khi env có khai báo.
// Mở lại sau: xoá model khỏi set này (không cần đổi env, không cần đổi code khác).
const V1_EXCLUDED_MODELS: RegExp[] = [
  /^nvidia\/nemotron-3\.5-lightning/, // latency cao, timeout ảnh hưởng UX
];

// Chain tối đa: primary + 2 fallback. Không vượt quá để giữ latency có kiểm soát.
export const MAX_CHAIN = 3;

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

export function isV1ExcludedModel(model: string): boolean {
  return V1_EXCLUDED_MODELS.some((re) => re.test(model));
}

export function isRetiredModel(model: string): boolean {
  return RETIRED_MODELS.some((re) => re.test(model));
}

// Chế độ structured output theo model (đã audit ở trên).
// Model lạ chưa biết -> json_object (mode rộng); nếu provider từ chối, pro-analysis
// hạ xuống "none" (prompt strict JSON) thay vì sập cả chain.
// deepseek/deepseek-v4.1-flash khai structured_outputs=true (audit
// /api/v1/models 2026-09-30) -> nâng lên json_schema, không dùng
// json_object. Đo production 15:18 (check 8b1f1bb0): với json_object cả
// 2 attempt DeepSeek trả validation_failed dù finish_reason=stop và KHÔNG
// bị cắt — json_object chỉ ép "là JSON", không ép đúng hình dạng schema,
// nên model tự do bỏ/sửa field và parseProAnalysis không tìm thấy headline.
export function structuredModeFor(model: string): StructuredMode {
  const id = model.toLowerCase();
  if (id.startsWith("qwen/qwen3.8-27b")) return "json_schema";
  if (id.startsWith("deepseek/deepseek-v4.1-flash")) return "json_schema";
  if (id.startsWith("inclusionai/ling-3.0-flash-vl")) return "json_schema";
  if (id.startsWith("google/gemma-4-31b")) return "json_object";
  if (id.startsWith("nvidia/nemotron-3.5-lightning")) return "none";
  // Audit /api/v1/models 2026-10-04: qwen/qwen3.7-flash KHÔNG có
  // structured_outputs, chỉ hỗ trợ response_format. json_schema bị từ chối.
  // json_object trần chỉ ép valid JSON -> parseProAnalysis không thấy headline
  // (runtime hip07u/ainr21). mode "none" -> model ramble, bị cắt 6000
  // (runtime 7qk1tf provider_truncated).
  // Nên dùng json_object_with_instruction: vẫn gửi response_format json_object
  // nhưng system prompt kèm PRO_ANALYSIS_STRICT_JSON_INSTRUCTION có schema.
  if (id.startsWith("qwen/qwen3.7-flash")) return "json_object_with_instruction";
  return "json_object";
}

// Model BẬT reasoning mặc định -> PHẢI tắt, nếu không reasoning nuốt hết
// max_tokens và content về rỗng.
//
// Audit /api/v1/models ngày 2026-09-30 (reasoning.default_enabled):
//   qwen/qwen3.8-27b[:free] -> default_enabled=true,  default_effort=xhigh
//   google/gemma-4-31b-it   -> default_enabled=false (không cần can thiệp)
//
// Vì sao đây là lỗi nghiêm trọng: OpenRouter tính reasoning tokens VÀO
// max_tokens, và effort "xhigh" chiếm ~95% ngân sách. Với max_tokens=3000
// thì ~2850 token đi vào suy luận, phần content còn lại không đủ phát ra
// ký tự nào -> provider_empty_content + finish_reason=length, dù provider
// đã trả 3000 output tokens và vẫn tính tiền. Log production 14:18 chính
// là ca này (input=986, output=3000, actual_model=qwen/qwen3.8-27b).
//
// Dùng `enabled: false` chứ không phải `effort: "none"`: model này khai
// supported_efforts = [xhigh, medium, low] — KHÔNG có "none", nên gửi
// effort:none có thể bị provider từ chối. mandatory=false nên tắt được.
//
// deepseek/deepseek-v4.1-flash: cùng lớp lỗi, effort="high" (thấp hơn
// xhigh nhưng vẫn nuốt hết). Đo production 2026-09-30 15:09, check
// 62ab3310: primary DeepSeek trả provider_truncated ở CẢ HAI attempt,
// finish_reason=length, output đúng 3000 = max_tokens, content bị cắt
// giữa chừng. Khác Qwen ở chỗ content vẫn có (nên là truncated chứ không
// phải empty), nhưng vẫn hỏng: Jev phải đổi model rồi Qwen mới ra được
// report, tốn 2 attempt + ~20s. Không có "none" trong supported_efforts
// ([max, high, low]) nên cũng phải tắt bằng enabled:false.
// Tham chiếu: https://openrouter.ai/docs/guides/reasoning-tokens
const REASONING_DISABLED: readonly string[] = [
  "qwen/qwen3.8-27b",
  "deepseek/deepseek-v4.1-flash",
];

// Trả về body param `reasoning` cho request, hoặc undefined để không gửi
// (model không bật reasoning mặc định -> thêm param là thừa).
export function reasoningConfigFor(model: string): { enabled: false } | undefined {
  const id = model.toLowerCase();
  const isThinking = REASONING_DISABLED.some((slug) =>
    id === slug || id.startsWith(`${slug}:free`),
  );
  return isThinking ? { enabled: false } : undefined;
}

// Đọc chain từ env, lọc denied + v1-excluded + trùng, cắt MAX_CHAIN.
// PRO_ANALYSIS_MODEL / PRO_ANALYSIS_FALLBACK_MODELS (phân tách bằng dấu phẩy).
// Model bị loại VẪN được log để không bị loại im lặng.
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
    if (isRetiredModel(m)) {
      console.warn(`[pro-analysis-model] skipped model=${m} reason=retired_by_provider`);
      continue;
    }
    if (isV1ExcludedModel(m)) {
      console.warn(`[pro-analysis-model] skipped model=${m} reason=excluded_in_v1`);
      continue;
    }
    if (!chain.includes(m)) chain.push(m);
    if (chain.length >= MAX_CHAIN) break;
  }
  return chain;
}
