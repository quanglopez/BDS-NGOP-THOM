// Snapshot scoring tại thời điểm check.
// Mục đích: report lịch sử phản ánh đúng kết quả lúc user check, không phụ thuộc
// việc lib/scoring.ts / keyword / rule local có bị sửa về sau.

import { scoreContributions } from "./score-explain";
import { SCORING_CODE_VERSION } from "./scoring";
import type { ActionType, AnalysisBreakdown, AnalysisResult, TagColor } from "./types";

export const SCORING_SNAPSHOT_SOURCE = "checkbds-snapshot-v1";

export interface ScoringSnapshot {
  overall_score: number;
  deal_type: string;
  tag: string;
  tag_color: TagColor;
  action_type: ActionType;
  breakdown: AnalysisBreakdown;
  score_contributions: { label: string; delta: number; note: string; kind: string }[];
  reasoning: string;
  action: string;
  generated_at: string;
  source: string;
  scoring_code_version: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, max = 4000): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Đọc snapshot từ DB. Trả null nếu thiếu/không đúng shape — caller fallback
// sang tầng thấp hơn, KHÔNG đoán bừa.
export function parseScoringSnapshot(raw: unknown): ScoringSnapshot | null {
  if (!isRecord(raw)) return null;
  const b = raw.breakdown;
  if (!isRecord(b)) return null;
  const item = (v: unknown): { score: number; label: string; detail: string } | null => {
    if (!isRecord(v) || typeof v.score !== "number") return null;
    return { score: v.score, label: str(v.label, 200), detail: str(v.detail, 1000) };
  };
  const ngop = item(b.ngop);
  const tangGia = item(b.tangGia);
  const thanhKhoan = item(b.thanhKhoan);
  const phapLy = item(b.phapLy);
  const viTri = item(b.viTri);
  if (!ngop || !tangGia || !thanhKhoan || !phapLy || !viTri) return null;
  if (!isRecord(b.giaThiTruong) || typeof b.giaThiTruong.diffPercent !== "number") return null;
  if (typeof raw.overall_score !== "number") return null;

  const contributions = Array.isArray(raw.score_contributions)
    ? raw.score_contributions.filter(isRecord).map((c) => ({
        label: str(c.label, 200),
        delta: numOrNull(c.delta) ?? 0,
        note: str(c.note, 1000),
        kind: str(c.kind, 20) || "neutral",
      }))
    : null;
  if (!contributions) return null;

  return {
    overall_score: raw.overall_score,
    deal_type: str(raw.deal_type, 50) || "binh_thuong",
    tag: str(raw.tag, 200),
    tag_color: (["green", "yellow", "red"] as const).includes(raw.tag_color as TagColor)
      ? (raw.tag_color as TagColor)
      : "yellow",
    action_type: (["hot", "ok", "skip"] as const).includes(raw.action_type as ActionType)
      ? (raw.action_type as ActionType)
      : "ok",
    breakdown: {
      ngop,
      tangGia,
      thanhKhoan,
      phapLy,
      viTri,
      giaThiTruong: {
        diffPercent: b.giaThiTruong.diffPercent,
        diffAmount: str(b.giaThiTruong.diffAmount, 200),
        label: str(b.giaThiTruong.label, 200),
        detail: str(b.giaThiTruong.detail, 1000),
      },
    },
    score_contributions: contributions,
    reasoning: str(raw.reasoning),
    action: str(raw.action),
    generated_at: str(raw.generated_at, 60),
    source: str(raw.source, 60),
    scoring_code_version: str(raw.scoring_code_version, 60),
  };
}

// Chụp snapshot từ AnalysisResult đã merge Jev (tức là đúng bộ số client hiển thị).
export function buildScoringSnapshot(args: {
  result: AnalysisResult;
  dealType: string;
  nowIso?: string;
}): ScoringSnapshot {
  const { result } = args;
  return {
    overall_score: result.overall,
    deal_type: args.dealType,
    tag: result.tag,
    tag_color: result.tagColor,
    action_type: result.actionType,
    breakdown: result.breakdown,
    score_contributions: scoreContributions(result).map((c) => ({
      label: c.label,
      delta: c.delta,
      note: c.note,
      kind: c.kind,
    })),
    reasoning: result.reasoning,
    action: result.action,
    generated_at: args.nowIso ?? new Date().toISOString(),
    source: SCORING_SNAPSHOT_SOURCE,
    // Version đi kèm công thức, không đọc từ env
    scoring_code_version: SCORING_CODE_VERSION,
  };
}

// Trả AnalysisResult từ snapshot để tái dùng đúng số đã chấm.
export function resultFromSnapshot(snap: ScoringSnapshot): AnalysisResult {
  return {
    overall: snap.overall_score,
    tag: snap.tag,
    tagColor: snap.tag_color,
    breakdown: snap.breakdown,
    reasoning: snap.reasoning,
    action: snap.action,
    actionType: snap.action_type,
    extracted: { price: "", area: "", street: "" },
  };
}
