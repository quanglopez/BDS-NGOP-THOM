// Lỗi của pipeline price-v1. Log chỉ được chứa error CODE, không chứa message thô:
// message của DB/provider có thể dài, khó đọc và nhiều khi chứa chi tiết schema
// hoặc dữ liệu. Ta phân loại thành mã ngắn, an toàn để log.

export class PricePipelineError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`price-intelligence:${code}`);
    this.name = "PricePipelineError";
    this.code = code;
  }
}

/** Mã lỗi an toàn để ghi log. Không bao giờ trả về message gốc. */
export function safeErrorCode(e: unknown): string {
  if (e instanceof PricePipelineError) return e.code;

  const pgCode = (e as { code?: unknown } | null)?.code;
  if (typeof pgCode === "string") {
    // PostgSQL / PostgREST
    if (pgCode === "42703" || pgCode === "PGRST204") return "schema_missing";
    if (pgCode === "42501") return "rls_denied";
    if (pgCode === "23505") return "duplicate_key";
    if (pgCode === "57014" || pgCode === "PGRST116") return "timeout";
    if (pgCode === "PGRST301") return "unauthorized";
  }

  if (e instanceof Error) {
    if (e.name === "AbortError") return "timeout";
    if (e.name === "TypeError") return "bad_response";
  }
  return "unknown";
}
