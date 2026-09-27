// Thin wrapper gọi OpenRouter API — CHỈ dùng server-side.
// Không log API key. Không trả raw provider response về client.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 25000;

export interface OpenRouterResult {
  ok: boolean;
  // Nội dung text của message đầu tiên (thường là JSON string theo yêu cầu)
  text: string | null;
  model: string;
  // Lý do thất bại để log/debug (không chứa key)
  error?: string;
  status?: number;
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
  } = opts;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    // Header tùy chọn của OpenRouter để xếp hạng/attribution — không bắt buộc
    if (siteUrl) headers["HTTP-Referer"] = siteUrl;
    if (siteName) headers["X-Title"] = siteName;

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers,
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPayload },
        ],
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, text: null, model, error: `provider_${res.status}`, status: res.status };
    }

    let data: unknown = null;
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, text: null, model, error: "provider_bad_json" };
    }

    const text =
      typeof data === "object" && data !== null
        ? (data as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message
            ?.content ?? null
        : null;

    if (typeof text !== "string" || !text.trim()) {
      return { ok: false, text: null, model, error: "provider_empty_content" };
    }
    return { ok: true, text: text.trim(), model };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { ok: false, text: null, model, error: aborted ? "provider_timeout" : "provider_network" };
  } finally {
    clearTimeout(timer);
  }
}
