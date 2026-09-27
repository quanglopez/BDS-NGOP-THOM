// Snapshot cache cho Pro Analysis. Tách ra khỏi route để test được
// và để đảm bảo "report là snapshot": đã lưu thì không gọi lại model.

export interface SnapshotRow {
  analysis_json?: unknown;
  analysis_version?: string | null;
}

export interface SnapshotUpdate {
  analysis_json: unknown;
  analysis_version: string;
  scoring_version: string;
  // Model THỰC TẾ đã sinh ra report (có thể là fallback model), không phải model yêu cầu.
  ai_model: string;
  ai_generated_at: string;
}

// Đã có snapshot đúng version -> trả cache, KHÔNG gọi OpenRouter lại.
// Không so sánh model: report tạo bằng Ling vẫn được giữ, không "nâng cấp" lại bằng Qwen.
export function isFreshSnapshot(row: SnapshotRow, currentVersion: string): boolean {
  const j = row.analysis_json;
  return (
    !!j &&
    typeof j === "object" &&
    !Array.isArray(j) &&
    row.analysis_version === currentVersion
  );
}

export function buildSnapshotUpdate(args: {
  analysis: unknown;
  actualModel: string;
  analysisVersion: string;
  scoringVersion: string;
  nowIso?: string;
}): SnapshotUpdate {
  return {
    analysis_json: args.analysis,
    analysis_version: args.analysisVersion,
    scoring_version: args.scoringVersion,
    ai_model: args.actualModel,
    ai_generated_at: args.nowIso ?? new Date().toISOString(),
  };
}
