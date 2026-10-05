// Serialize lỗi scan radar cho log mà KHÔNG làm mất PostgREST error object.
//
// Vì sao cần: `e instanceof Error ? e.message : String(e)` biến lỗi PostgREST
// (plain object `{code, message, details, hint}`) thành chuỗi "[object Object]"
// — mất hết message lẫn stack, nên log production không chỉ ra query nào hỏng.
//
// Ràng buộc: chỉ lấy field AN TOÀN, KHÔNG stringify cả object (có thể chứa
// payload/credentials), và redact mọi giá trị trông giống secret.

const SAFE_KEYS = ["name", "message", "code", "details", "hint", "stack"] as const;

/** Khoá/giá trị nhạy cảm không bao giờ được ghi ra log. */
const SECRET_KEY = /^(authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token|session|jwt|bearer|body|request|headers|env|service[-_]?role)$/i;

/** Giá trị trông giốnh secret dù nằm trong field khác (vd message chứa key). */
const SECRET_VALUE = /(sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9._-]{10,}|(?:api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|passwd)\s*[=:]\s*\S+)/i;

const MAX_LEN = 300;

function safeText(v: unknown): string {
  let s: string;
  try {
    s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
  } catch {
    return "";
  }
  if (!s) return "";
  const redacted = s.replace(SECRET_VALUE, "[redacted]");
  return redacted.length > MAX_LEN ? `${redacted.slice(0, MAX_LEN)}…` : redacted;
}

/**
 * Trả về chuỗi log đã an toàn. Error → name/message/stack.
 * Plain object (PostgREST) → chỉ field whitelist, JSON.stringify phần đã redact.
 * Không bao giờ trả "[object Object]".
 */
export function describeScanError(e: unknown): string {
  if (e instanceof Error) {
    return JSON.stringify({
      name: safeText(e.name) || "Error",
      message: safeText(e.message),
      stack: safeText(e.stack),
    });
  }
  if (e && typeof e === "object") {
    const src = e as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const key of SAFE_KEYS) {
      if (!(key in src)) continue;
      const value = src[key];
      if (SECRET_KEY.test(key)) continue;
      const text = safeText(value);
      if (text) out[key] = text;
    }
    if (Object.keys(out).length > 0) return JSON.stringify(out);
  }
  // Không phải object, không phải Error: vẫn phải có gì đọc được.
  return safeText(e) || "unknown_error";
}