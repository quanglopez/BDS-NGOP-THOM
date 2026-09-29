// Lỗi của pipeline price-v1. Log chỉ được chứa error CODE, không chứa message thô:
// message của DB/provider có thể dài, khó đọc và nhiều khi chứa chi tiết schema
// hoặc dữ liệu. Ta phân loại thành mã ngắn, an toàn để log.

export class PricePipelineError extends Error {
  readonly code: string;
  /** Lỗi gốc (PostgREST/PG) để truy vết. Không bao giờ log message thô ra ngoài. */
  constructor(code: string, options?: { cause?: unknown }) {
    super(`price-intelligence:${code}`, options);
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
    // 23514 = vi pham check constraint. Hay gap nhat khi code va DB lech
    // (vi du 0013 cau scope_level chi cho ward/province trong khi code ghi
    // district) -> phai log ra, khong dua ve chung "unknown".
    if (pgCode === "23514") return "check_violation";
    if (pgCode === "57014" || pgCode === "PGRST116") return "timeout";
    if (pgCode === "PGRST301") return "unauthorized";
    // Lop loi 42xxx (syntax/access rule) va 5xxxx (system) deu la loi DB, khong
    // phai loi nghiep vu -> gom lai de log doc la duoc.
    if (pgCode.startsWith("42")) return "db_error";
    if (pgCode.startsWith("5")) return "db_unavailable";
  }

  if (e instanceof Error) {
    if (e.name === "AbortError") return "timeout";
    if (e.name === "TypeError") return "bad_response";
  }
  return "unknown";
}
