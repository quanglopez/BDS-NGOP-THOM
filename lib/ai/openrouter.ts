// Thin wrapper gọi OpenRouter API — CHỈ dùng server-side.
// Không log/gửi API key. Trả về model THỰC TẾ provider đã dùng + usage để đo.
// Capability mỗi model được chọn ở lib/ai/model-chain.ts; wrapper này chỉ nhận
// chế độ structured output đã quyết định, không tự gửi param vô điều kiện.
//
// stream:true — bắt buộc. Non-streaming khiến OpenRouter buffer cả generation
// rồi mới trả, nên client không nhận byte nào cho tới cuối và deadline đo
// TỔNG generation time. Với SSE, deadline (xem `arm`) là idle time: chỉ bắn
// khi provider im lặng quá lâu, nên TTFT nằm trong budget là đủ.
// KHÔNG validate JSON ở đây — parseProAnalysis (lib/ai/schema.ts) sở hữu
// việc parse và bóc code fence.

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
  | "provider_truncated"
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
  // "stop" | "length" (bị cắt cụt) | "content_filter" | "error"...
  // length = nguyên nhân rất hay gặp khiến JSON không parse được
  finishReason: string | null;
  // Message rút gọn để chẩn đoán 4xx. Chỉ dùng server-side, KHÔNG trả về client.
  errorMessage?: string;
}

const EMPTY_USAGE: OpenRouterUsage = { promptTokens: null, completionTokens: null };

// Cắt bỏ rủi ro lộ secret/PII nếu provider vô tình echo lại trong message:
// API key, email, và mọi cụm số 9-11 chữ số (SĐT Việt Nam).
function sanitize(msg: string): string {
  return msg
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted_key]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[redacted_email]")
    .replace(/\b\d{9,11}\b/g, "[redacted_digits]")
    .replace(/\s+/g, " ")
    .slice(0, 200);
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

  const base = { ok: false, text: null, requestedModel: model, actualModel: null, usage: EMPTY_USAGE, latencyMs: 0, finishReason: null as string | null };
  const ctrl = new AbortController();
  const startedAt = Date.now();

  // Deadline là IDLE TIME, không phải tổng thời gian sinh.
  //
  // Trước đây timer hẹn một lần lúc gọi: bất kể provider đã trả header
  // hay chưa, hết timeout là abort. Với response KHÔNG stream, OpenRouter
  // buffer toàn bộ generation rồi mới trả, nên client không nhận byte nào
  // cho tới cuối — deadline đo tổng generation time. Đo production
  // 2026-09-30: 4 slug khác nhau đều abort đúng ở trần 15s/30s với
  // http_status=-, trong khi log OpenRouter cho thấy chúng hoàn tất và
  // vẫn bị tính tiền (TTFT 0.36-4.05s, output 712-2368 tok).
  //
  // Nay arm lại mỗi khi stream còn sống: deadline chỉ bắn khi provider im
  // lặng quá lâu. TTFT nằm trong budget thì phần còn lại có thể stream
  // bao lâu cũng không bị giết.
  let timer: NodeJS.Timeout | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const arm = (ms: number) => {
    clearTimeout(timer); // handle luôn được gán lại ngay sau => clear là cần thiết
    timer = setTimeout(() => ctrl.abort(), Math.max(1000, ms));
  };
  arm(timeoutMs);

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
      // Bắt buộc để deadline đo time-to-first-token thay vì tổng generation.
      stream: true,
      // OpenRouter KHÔNG gửi frame usage ở chế độ stream nếu không bật
      // include_usage -> metrics log lặng lẽ mất input_tokens/output_tokens.
      stream_options: { include_usage: true },
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

    // Lỗi HTTP (429, 400 param không hỗ trợ, 5xx): OpenRouter trả JSON
    // thường, KHÔNG phải SSE. Đọc body ĐÚNG MỘT LẦN — res.text() chỉ dùng
    // được một lần, gọi lần hai sẽ ném Body-Used.
    if (!res.ok) {
      let raw = "";
      try {
        raw = await res.text();
      } catch {
        raw = "";
      }
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

    // stream:true -> SSE. Đọc từng dòng `data: {...}`, gom delta.content,
    // dừng ở [DONE] (hoặc khi reader hết/không còn stream).
    if (!res.body) {
      return { ...base, latencyMs, error: "provider_empty_content", errorMessage: "no response body" };
    }

    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let responseModel: string | null = null;
    let finishReason: string | null = null;
    let usage: OpenRouterUsage = EMPTY_USAGE;
    let sawDone = false;
    let streamError: string | null = null;

    // Một sự kiện SSE có thể bị cắt giữa các chunk -> giữ phần dư buffer
    // cho lần đọc sau, CHỈ xử lý dòng đã kết thúc bằng newline.
    const consumeLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const payload = trimmed.slice(5).trim();
      if (!payload) return;
      if (payload === "[DONE]") {
        sawDone = true;
        return;
      }
      let evt: unknown;
      try {
        evt = JSON.parse(payload);
      } catch {
        return; // chunk không phải JSON -> bỏ, không làm hỏng cả stream
      }
      if (typeof evt !== "object" || evt === null) return;
      const o = evt as {
        model?: unknown;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
        choices?: {
          finish_reason?: unknown;
          delta?: { content?: unknown };
          error?: { message?: unknown };
        }[];
      };
      if (typeof o.model === "string") responseModel = o.model;
      if (typeof o.choices?.[0]?.finish_reason === "string") finishReason = o.choices[0].finish_reason as string;
      const c = o.choices?.[0]?.delta?.content;
      if (typeof c === "string") content += c;
      const e = o.choices?.[0]?.error?.message;
      if (!streamError && typeof e === "string" && e.trim()) streamError = e.trim();
      const u = o.usage;
      if (u && typeof u === "object") {
        usage = {
          promptTokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : usage.promptTokens,
          completionTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : usage.completionTokens,
        };
      }
    };

    while (!sawDone) {
      const { value, done } = await reader.read();
      if (done) break;
      // Stream còn sống -> reset idle deadline.
      arm(timeoutMs);
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        consumeLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    if (buffer.trim()) consumeLine(buffer);

    // Thời gian thực tế của lần gọi, không phải TTFT.
    const totalMs = Date.now() - startedAt;

    // Provider trả lỗi trong event (HTTP vẫn 200) -> provider_error,
    // giữ nguyên ngữ nghĩa như bản non-streaming (choice.error.message).
    if (streamError) {
      return { ...base, latencyMs: totalMs, actualModel: responseModel, usage, finishReason, error: "provider_error", errorMessage: sanitize(streamError) };
    }

    if (!content.trim()) {
      return { ...base, latencyMs: totalMs, actualModel: responseModel, usage, finishReason, error: "provider_empty_content", errorMessage: `finish_reason=${finishReason ?? "null"}` };
    }
    // Bị cắt cụt -> JSON gần như chắc chắn hỏng, đánh dấu để log rõ
    if (finishReason === "length") {
      return { ...base, latencyMs: totalMs, actualModel: responseModel, usage, finishReason, error: "provider_truncated", errorMessage: `finish_reason=length output_truncated=true` };
    }
    // KHÔNG validate JSON ở đây. parseProAnalysis (lib/ai/schema.ts) là nơi
    // duy nhất parse, và nó bóc code fence markdown trước khi parse. Nếu
    // parse thêm ở tầng transport, output bọc ```json sẽ bị từ chối ở đây
    // thay vì tới validation_failed như trước.
    return { ok: true, text: content.trim(), requestedModel: model, actualModel: responseModel, usage, latencyMs: totalMs, finishReason };
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
    // Stream bị abort giữa chừng sẽ giữ socket mở nếu không cancel.
    void reader?.cancel().catch(() => undefined);
  }
}
