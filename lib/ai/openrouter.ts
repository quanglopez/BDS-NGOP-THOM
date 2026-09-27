// Thin wrapper gọi OpenRouter API — CHỈ dùng server-side.
// Không log/gửi API key. Trả về model THỰC TẾ provider đã dùng + usage để đo.
// Capability mỗi model được chọn ở lib/ai/model-chain.ts; wrapper này chỉ nhận
// chế độ structured output đã quyết định, không tự gửi param vô điều kiện.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Mỗi lần gọi tối đa 15s: chain 3 model x 2 attempt vẫn nằm trong budget
// serverless. Toàn chain có deadline riêng (xem pro-analysis.ts).
const DEFAULT_TIMEOUT_MS = 15000;

export type StructuredMode = "json_schema" | "json_object" | "none";

export interface OpenRouterUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

export type ProviderErrorCode =
  | "provider_429"
  | "provider_timeout"
  | "provider_network"
  | "provider_bad_json"
  | "provider_empty_content"
  | "provider_unsupported_param"
  | "provider_error";

export interface OpenRouterResult {
  ok: boolean;
  // Nội dung text của message đầu tiên (thường là JSON string)
  text: string | null;
  requestedModel: string;
  // Model thực tế provider đã trả lời (response.model) — ưu tiên lưu giá trị này
  actualModel: string | null;
  usage: OpenRouterUsage;
  latencyMs: number;
  error?: ProviderErrorCode;
  status?: number;
  // Message rút gọn để chẩn đoán 4xx. Chỉ dùng server-side, KHÔNG trả về client.
  errorMessage?: string;
}

const EMPTY_USAGE: OpenRouterUsage = { promptTokens: null, completionTokens: null };

// Provider có thể trả text trong `error` (NonStreamingChoice.error) khi
// generation lỗi ở tầng upstream dù HTTP 200.
function choiceErrorText(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const choice = (raw as { choices?: { error?: { message?: unknown } }[] }).choices?.[0];
  const msg = choice?.error?.message;
  return typeof msg === "string" && msg.trim() ? msg.trim() : null;
}

// Cắt bỏ rủi ro lộ key nếu provider vô tình echo lại trong message
function sanitize(msg: string): string {
  return msg.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]").replace(/\s+/g, " ").slice(0, 200);
}

// Provider từ chối param structured output -> cần hạ xuống prompt-only
export function isUnsupportedParamError(status: number | undefined, message: string | undefined): boolean {
  if (status === 400 || status === 404 || status === 422) {
    return /response_format|json_schema|structured|schema/i.test(message ?? "");
  }
  return false;
}

export async function callOpenRouter(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPayload: string;
  maxTokens?: number;
  temperature?: number;
  siteUrl?: string;
  siteName?: string;
  structuredMode?: StructuredMode;
  jsonSchema?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<OpenRouterResult> {
  const {
    apiKey,
    model,
    systemPrompt,
    userPayload,
    maxTokens = 1500,
    temperature = 0.2,
    siteUrl,
    siteName,
    structuredMode = "json_object",
    jsonSchema,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts;

  const base = { ok: false, text: null, requestedModel: model, actualModel: null, usage: EMPTY_USAGE, latencyMs: 0 };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));
  const startedAt = Date.now();

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    // Header tùy chọn của OpenRouter để xếp hạng/attribution — không bắt buộc
    if (siteUrl) headers["HTTP-Referer"] = siteUrl;
    if (siteName) headers["X-Title"] = siteName;

    // CHỈ gửi response_format khi model được audit là hỗ trợ.
    // Model không hỗ trợ -> không gửi param, dùng strict JSON instruction trong prompt.
    const body: Record<string, unknown> = {
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPayload },
      ],
    };
    if (structuredMode === "json_schema" && jsonSchema) {
      body.response_format = { type: "json_schema", json_schema: jsonSchema };
    } else if (structuredMode === "json_object") {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers,
      body: JSON.stringify(body),
    });

    const latencyMs = Date.now() - startedAt;
    const raw = await res.text();

    if (!res.ok) {
      let detail = "";
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: unknown } };
        if (typeof parsed.error?.message === "string") detail = sanitize(parsed.error.message);
      } catch {
        detail = sanitize(raw);
      }
      const unsupported = isUnsupportedParamError(res.status, detail);
      return {
        ...base,
        latencyMs,
        status: res.status,
        error: unsupported
          ? "provider_unsupported_param"
          : res.status === 429
            ? "provider_429"
            : "provider_error",
        errorMessage: detail || undefined,
      };
    }

    let data: unknown = null;
    try {
      data = JSON.parse(raw);
    } catch {
      return { ...base, latencyMs, error: "provider_bad_json", errorMessage: sanitize(raw) };
    }

    const responseModel =
      typeof (data as { model?: unknown }).model === "string"
        ? ((data as { model: string }).model)
        : null;
    const usageRaw = (data as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage;
    const usage: OpenRouterUsage = {
      promptTokens: typeof usageRaw?.prompt_tokens === "number" ? usageRaw.prompt_tokens : null,
      completionTokens: typeof usageRaw?.completion_tokens === "number" ? usageRaw.completion_tokens : null,
    };

    // HTTP 200 nhưng generation lỗi ở choice
    const choiceError = choiceErrorText(data);
    if (choiceError) {
      return { ...base, latencyMs, actualModel: responseModel, usage, error: "provider_error", errorMessage: sanitize(choiceError) };
    }

    const text =
      typeof data === "object" && data !== null
        ? (data as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message
            ?.content ?? null
        : null;

    if (typeof text !== "string" || !text.trim()) {
      return { ...base, latencyMs, actualModel: responseModel, usage, error: "provider_empty_content" };
    }
    return { ok: true, text: text.trim(), requestedModel: model, actualModel: responseModel, usage, latencyMs };
  } catch (e) {
    const latencyMs = Date.now() - startedAt;
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ...base,
      latencyMs,
      error: aborted ? "provider_timeout" : "provider_network",
      errorMessage: aborted ? undefined : sanitize(e instanceof Error ? e.message : "unknown"),
    };
  } finally {
    clearTimeout(timer);
  }
}
