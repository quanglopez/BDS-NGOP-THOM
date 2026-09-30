// Stub SSE dùng chung cho các test OpenRouter.
//
// callOpenRouter gửi stream:true (lib/ai/openrouter.ts). OpenRouter thực tế
// trả chuỗi event `data: {...}`, còn Response(JSON) của stub cũ không có
// delta.content nên client gom được 0 ký tự -> provider_empty_content.
//
// Helper này dựng đúng chuỗi event: 1 event delta.role, N event delta.content
// (chia nhỏ để thật sự kiểm tra việc ghép chuỗi), 1 event finish_reason +
// usage, rồi [DONE]. Lỗi HTTP (khác 200) vẫn trả JSON thường như thật.

export interface StubResponse {
  status: number;
  payload: unknown;
}

function encodeSse(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const wire = events
    .map((e) => (e === "[DONE]" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(e)}\n\n`))
    .join("");
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(wire));
      controller.close();
    },
  });
}

/**
 * Chuyển payload non-streaming ({model, choices:[{message:{content}}], usage})
 * sang Response SSE. `chunks` = số lần chia content.
 */
export function sseResponse(payload: unknown, fallbackModel: string, chunks = 3): Response {
  const p = payload as {
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const model = p.model ?? fallbackModel;
  const content = p.choices?.[0]?.message?.content ?? "";
  const finish = p.choices?.[0]?.finish_reason ?? "stop";
  const size = Math.max(1, Math.ceil(content.length / chunks));
  const parts: string[] = [];
  for (let i = 0; i < content.length; i += size) parts.push(content.slice(i, i + size));
  return new Response(
    encodeSse([
      { model, choices: [{ index: 0, delta: { role: "assistant" } }] },
      ...parts.map((c) => ({ model, choices: [{ index: 0, delta: { content: c } }] })),
      {
        model,
        choices: [{ index: 0, delta: {}, finish_reason: finish }],
        ...(p.usage ? { usage: p.usage } : {}),
      },
      "[DONE]",
    ]),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

/** JSON thường cho nhánh lỗi HTTP. */
export function jsonResponse(status: number, payload: unknown): Response {
  return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}