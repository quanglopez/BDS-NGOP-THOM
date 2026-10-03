// Auto-Enrichment provider: dùng CHUNG bộ câu hỏi Jev với Check thủ công
// (lib/ai/jev-check.ts). Chỉ gọi 1 lần / attempt — retry do worker quyết định
// (shouldRetry + backOffMs), không retry ngầm ở đây.

import { CHECK_QUESTIONS, callJevOnce, investmentScore100 } from "@/lib/ai/jev-check";
import { publishedConfidence, type AutoProviderOutcome } from "./auto-enrollment";

export type EnrichmentProvider = (input: Record<string, unknown>) => Promise<AutoProviderOutcome>;

/** Deal type hợp lệ — chốt với bộ criteria của Jev; giá trị lạ coi như unknown (null). */
const DEAL_TYPES = new Set(["ngop_ngon", "thom_dau_tu", "gia_cao", "rui_ro_phap_ly", "binh_thuong"]);

/** Text trạng thái gửi Jev, dựng TỪ material input đã đóng băng lúc enqueue.
 *  Không đọc URL, không refetch, không đụng original_text. */
export function buildEnrichmentState(input: Record<string, unknown>): string {
  const lines: string[] = [];
  if (typeof input.title === "string" && input.title.trim()) lines.push(`Tiêu đề: ${input.title.trim()}`);
  const area = [input.area_name, input.region_name].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  if (area.length) lines.push(`Khu vực: ${area.join(", ")}`);
  if (typeof input.price_vnd === "number" && Number.isFinite(input.price_vnd)) {
    lines.push(`Giá: ${Math.round(input.price_vnd / 1e8) / 10} tỷ`);
  }
  if (typeof input.size_m2 === "number" && Number.isFinite(input.size_m2)) {
    lines.push(`Diện tích: ${input.size_m2} m2`);
  }
  if (typeof input.rooms === "number" && Number.isFinite(input.rooms)) {
    lines.push(`Số phòng: ${input.rooms}`);
  }
  return lines.join("\n");
}

type JevAnswers = Record<string, { score?: unknown; noul?: unknown; choice?: unknown; confidence?: unknown }>;

/** Map câu trả lời Jev -> outcome của worker. Null semantics:
 *  score=0 là giá trị thật; thiếu field -> null; chỉ medium/high mới publish.
 *  - Output hỏng (số ngoài thang) -> retryable_error (malformed).
 *  - Không có tín hiệu nào -> insufficient_data (terminal, không retry).
 *  - Có tín hiệu nhưng confidence thấp/thiếu -> low_confidence (terminal, không publish). */
export function mapEnrichmentAnswers(data: unknown): AutoProviderOutcome {
  const root = (data && typeof data === "object" ? ((data as { answers?: unknown }).answers ?? data) : null) as JevAnswers | null;
  if (!root || typeof root !== "object") return { kind: "retryable_error" };

  const investRaw = root.investment_potential?.score;
  const invest100 = investmentScore100(investRaw);
  if (invest100 != null && (invest100 < 0 || invest100 > 100)) return { kind: "retryable_error" };

  const choice = root.deal_type?.choice;
  const dealType = typeof choice === "string" && DEAL_TYPES.has(choice) ? choice : null;

  const noul = root.is_ngop?.noul;
  const isNgoP = typeof noul === "number" && Number.isFinite(noul) ? Math.round(noul * 100) : null;
  if (isNgoP != null && (isNgoP < 0 || isNgoP > 100)) return { kind: "retryable_error" };

  if (invest100 == null && dealType == null && isNgoP == null) return { kind: "insufficient_data" };

  const confidence = publishedConfidence(root.deal_type?.confidence);
  if (!confidence) return { kind: "low_confidence" };

  return { kind: "published", score: invest100, dealType, isNgoP, confidence };
}

export function createJevEnrichmentProvider(deps: {
  key: string;
  timeoutMs?: number;
  call?: (key: string, body: unknown, timeoutMs: number) => Promise<Response>;
}): EnrichmentProvider {
  const call = deps.call ?? callJevOnce;
  const timeoutMs = deps.timeoutMs ?? 25_000;
  return async (input) => {
    const state = buildEnrichmentState(input);
    let res: Response;
    try {
      res = await call(deps.key, { model: "jev-latest", state, questions: CHECK_QUESTIONS }, timeoutMs);
    } catch {
      // timeout / mạng sập -> có thể retry
      return { kind: "retryable_error" };
    }
    if (res.status === 429 || res.status >= 500) return { kind: "retryable_error" };
    if (res.status >= 400) return { kind: "terminal_error" };
    let data: unknown;
    try {
      data = JSON.parse(await res.text());
    } catch {
      return { kind: "retryable_error" };
    }
    return mapEnrichmentAnswers(data);
  };
}
