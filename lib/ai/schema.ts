// Schema Pro Analysis JSON — validate bằng tay (repo không dùng Zod để khỏi phình dependency).
// Mọi field AI đều optional ở tầng parse; tầng validate sẽ ép chuẩn tối thiểu.

export type Confidence = "low" | "medium" | "high";
export type HighlightType = "positive" | "neutral" | "warning";
export type Severity = "high" | "medium" | "low";
export type Priority = "high" | "medium" | "low";

export interface ProHighlight {
  type: HighlightType;
  title: string;
  explanation: string;
  evidence_source: string;
}

export interface ProStrengthWeakness {
  title: string;
  explanation: string;
  evidence_source: string;
}

export interface ProFactorAnalysis {
  factor: string;
  score: number;
  label: string;
  explanation: string;
  evidence_source: string;
}

export interface ProPriceAnalysis {
  available: boolean;
  asking_price: number | null;
  price_per_m2: number | null;
  reference_available: boolean;
  reference_median: number | null;
  difference_percent: number | null;
  explanation: string;
}

export interface ProWarning {
  severity: Severity;
  title: string;
  explanation: string;
  requires_verification: boolean;
  evidence_source: string;
}

export interface ProNextStep {
  priority: Priority;
  title: string;
  reason: string;
}

export interface ProAnalysis {
  summary: { headline: string; text: string; confidence: Confidence };
  highlights: ProHighlight[];
  score_explanation: { summary: string; strengths: ProStrengthWeakness[]; weaknesses: ProStrengthWeakness[] };
  factor_analysis: ProFactorAnalysis[];
  price_analysis: ProPriceAnalysis;
  warnings: ProWarning[];
  next_steps: ProNextStep[];
  limitations: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, max = 1200): string {
  return typeof v === "string" ? v.slice(0, max).trim() : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(isRecord).slice(0, 20) : [];
}

function sw(v: unknown): ProStrengthWeakness {
  const r = isRecord(v) ? v : {};
  return {
    title: str(r.title, 200) || "Chưa rõ",
    explanation: str(r.explanation) || "Chưa đủ dữ liệu để kết luận.",
    evidence_source: str(r.evidence_source, 200) || "listing",
  };
}

// Lý do parse thất bại. Log trước đây gộp cả 3 ca vào một chuỗi
// "json_unparseable_or_missing_headline" nên không phân biệt được model
// trả JSON hỏng với model trả JSON thiếu headline. Tách ra để log đúng.
export type ParseFailureReason = "json_parse_failed" | "not_an_object" | "missing_headline";

export type ParseResult =
  | { ok: true; analysis: ProAnalysis }
  | { ok: false; reason: ParseFailureReason; detail: string; topKeys: string[] };

// Dùng khi cần chẩn đoán (pro-analysis log). KHÔNG log nội dung model —
// chỉ log hình dạng: lý do, kích thước, và tên key cấp 1 (tên key đến từ
// schema, không phải PII của listing).
export function parseProAnalysisDetailed(raw: string): ParseResult {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const hadFence = unfenced !== trimmed;
  let data: unknown;
  try {
    data = JSON.parse(unfenced);
  } catch (e) {
    return {
      ok: false,
      reason: "json_parse_failed",
      // Chỉ lấy message của JSON.parse (vị trí lỗi), KHÔNG log raw.
      detail: `${e instanceof Error ? e.message : "unknown"} fence=${hadFence}`,
      topKeys: [],
    };
  }
  if (!isRecord(data)) {
    return {
      ok: false,
      reason: "not_an_object",
      detail: `typeof=${Array.isArray(data) ? "array" : typeof data} fence=${hadFence}`,
      topKeys: [],
    };
  }

  const topKeys = Object.keys(data).slice(0, 20);
  const summary = isRecord(data.summary) ? data.summary : {};
  const headline = str(summary.headline, 200);
  if (!headline) {
    return {
      ok: false,
      reason: "missing_headline",
      detail: `has_summary=${isRecord(data.summary)} fence=${hadFence}`,
      topKeys,
    };
  }
  return { ok: true, analysis: coerce(data, summary, headline) };
}

// Parse + ép chuẩn JSON AI trả về. Trả null nếu thiếu hẳn khung tối thiểu
// (không có summary/headline) để caller retry hoặc fallback.
export function parseProAnalysis(raw: string): ProAnalysis | null {
  const r = parseProAnalysisDetailed(raw);
  return r.ok ? r.analysis : null;
}

function coerce(
  data: Record<string, unknown>,
  summary: Record<string, unknown>,
  headline: string,
): ProAnalysis {

  const scoreExplanation = isRecord(data.score_explanation) ? data.score_explanation : {};
  const priceRaw = isRecord(data.price_analysis) ? data.price_analysis : {};

  const pricePerM2 = num(priceRaw.price_per_m2);
  const refMedian = num(priceRaw.reference_median);
  const refAvail = priceRaw.reference_available === true;
  const diffPct = num(priceRaw.difference_percent);

  return {
    summary: {
      headline,
      text: str(summary.text, 2000) || "Chưa đủ dữ liệu để kết luận.",
      confidence: oneOf(summary.confidence, ["low", "medium", "high"] as const, "low"),
    },
    highlights: arr(data.highlights).slice(0, 6).map((h) => ({
      type: oneOf(h.type, ["positive", "neutral", "warning"] as const, "neutral"),
      title: str(h.title, 200) || "Chưa rõ",
      explanation: str(h.explanation) || "Chưa đủ dữ liệu để kết luận.",
      evidence_source: str(h.evidence_source, 200) || "listing",
    })),
    score_explanation: {
      summary: str(scoreExplanation.summary, 1000),
      strengths: arr(scoreExplanation.strengths).slice(0, 5).map(sw),
      weaknesses: arr(scoreExplanation.weaknesses).slice(0, 5).map(sw),
    },
    factor_analysis: arr(data.factor_analysis)
      .slice(0, 8)
      .map((f) => ({
        factor: str(f.factor, 120) || "Chưa rõ",
        score: Math.max(0, Math.min(100, Math.round(num(f.score) ?? 50))),
        label: str(f.label, 120),
        explanation: str(f.explanation) || "Chưa đủ dữ liệu để kết luận.",
        evidence_source: str(f.evidence_source, 200) || "listing",
      })),
    price_analysis: {
      available: priceRaw.available === true,
      asking_price: num(priceRaw.asking_price),
      price_per_m2: pricePerM2,
      // Reference chỉ tồn tại khi có median thật — ép false nếu không có số
      reference_available: refAvail && refMedian !== null,
      reference_median: refMedian,
      difference_percent: refAvail && refMedian !== null ? diffPct : null,
      explanation: str(priceRaw.explanation) || "Chưa đủ dữ liệu tham chiếu để so sánh giá khu vực.",
    },
    warnings: arr(data.warnings)
      .slice(0, 10)
      .map((w) => ({
        severity: oneOf(w.severity, ["high", "medium", "low"] as const, "medium"),
        title: str(w.title, 200) || "Cần kiểm tra",
        explanation: str(w.explanation) || "Nên kiểm tra thêm.",
        requires_verification: w.requires_verification !== false,
        evidence_source: str(w.evidence_source, 200) || "listing",
      })),
    next_steps: arr(data.next_steps)
      .slice(0, 8)
      .map((n) => ({
        priority: oneOf(n.priority, ["high", "medium", "low"] as const, "medium"),
        title: str(n.title, 200) || "Kiểm tra thêm",
        reason: str(n.reason) || "Chưa đủ dữ liệu để kết luận.",
      })),
    limitations: Array.isArray(data.limitations)
      ? data.limitations.filter((x): x is string => typeof x === "string").slice(0, 8)
      : [],
  };
}
