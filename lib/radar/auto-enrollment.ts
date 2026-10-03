// Auto-Enrichment V1: eligibility, fingerprint, giới hạn, trạng thái.
// Cam kết non-blocking: hàm này chỉ ra quyết định enqueue/dispatch, KHÔNG await AI.

export const AUTO_ENRICHMENT_PER_RADAR_CAP = 25;
export const AUTO_ENRICHMENT_DAILY_LIMIT = 200;
export const AUTO_ENRICHMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const AUTO_ENROLLMENT_STATUSES = [
  "not_started",
  "pending",
  "processing",
  "completed",
  "insufficient_data",
  "low_confidence",
  "failed",
] as const;
export type AutoEnrollmentStatus = (typeof AUTO_ENROLLMENT_STATUSES)[number];

export type AutoProviderOutcome =
  | { kind: "published"; score: number | null; dealType: string | null; isNgoP: number | null; confidence: "medium" | "high" }
  | { kind: "insufficient_data" }
  | { kind: "low_confidence" }
  | { kind: "retryable_error" }
  | { kind: "terminal_error" };

export function normalizeAutoConfidence(value: unknown): "low" | "medium" | "high" | null {
  if (typeof value === "string") {
    const v = value.toLowerCase() as "low" | "medium" | "high";
    if (["low", "medium", "high"].includes(v)) return v;
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value >= 0.8) return "high";
  if (value >= 0.55) return "medium";
  return "low";
}

export function publishedConfidence(value: unknown): "medium" | "high" | null {
  const c = normalizeAutoConfidence(value);
  return c === "high" || c === "medium" ? c : null;
}

// Material whitelist: chỉ các trường đủ rõ và cần cho AI. KHÔNG có url/original text.
export function materialInputFromRow(row: NonNullable<Record<string, unknown>>): Record<string, number | string | null> {
  return {
    title: typeof row.title === "string" && row.title.trim() ? row.title : null,
    category_code: typeof row.category_code === "number" ? row.category_code : null,
    area_v2: typeof row.area_v2 === "number" ? row.area_v2 : null,
    area_name: typeof row.area_name === "string" && row.area_name.trim() ? row.area_name : null,
    region_name: typeof row.region_name === "string" && row.region_name.trim() ? row.region_name : null,
    price_vnd: typeof row.price_vnd === "number" ? row.price_vnd : null,
    size_m2: typeof row.size_m2 === "number" ? row.size_m2 : null,
    price_per_m2: typeof row.price_per_m2 === "number" ? row.price_per_m2 : null,
    rooms: typeof row.rooms === "number" ? row.rooms : null,
  };
}

// Fingerprint ổn định: JSON sắp xếp key, tránh thay đổi thứ tự khi cùng ý nghĩa.
export function materialFingerprint(input: Record<string, unknown>): string {
  const keys = Object.keys(input).sort();
  const values = keys.map((k) => `"${k}":${JSON.stringify(input[k] ?? null)}`);
  return `{${values.join(",")}}`;
}

export function isMinimumMaterialAvailable(input: Record<string, unknown>): boolean {
  // PRD không force title mandatory nếu các số liệu hợp lệ; contract: giá + diện tích > 0 tối thiểu.
  const price = typeof input.price_vnd === "number" ? input.price_vnd : null;
  const size = typeof input.size_m2 === "number" ? input.size_m2 : null;
  return price != null && price > 0 && size != null && size > 0;
}

export function sameMaterial(oldHash: string | null | undefined, newHash: string): boolean {
  return typeof oldHash === "string" && oldHash === newHash;
}

// TTL áp dụng cho các terminal trạng thái: completed/insufficient/low/failed.
// Không retry cùng fingerprint trong TTL; hết TTL có thể xét lại.
export function isStale(v: string, nowMs = Date.now()): boolean {
  const t = Date.parse(v);
  if (Number.isNaN(t)) return false;
  return nowMs - t >= AUTO_ENRICHMENT_TTL_MS;
}

// Quyết định có retry hay không. Chỉ error/timeout/malformed; không retry insufficient/low/validation.
export function shouldRetry(outcome: AutoProviderOutcome, attempts: number): boolean {
  if (attempts >= 3) return false; // tổng tối đa 3 lần gọi: 1 lần đầu + 2 retry.
  return outcome.kind === "retryable_error";
}

export function backOffMs(attempt: number): number {
  // Exponential + jitter deterministic-free: trả max, test không chờ thật.
  return Math.min(30_000, 250 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
}

// Chỉ quay lại created/started retry khi lỗi có thể retry.
export function nextAttemptsOnError(previousAttempts: number): number {
  return previousAttempts + 1;
}

// Nguồn provenance để UI hiển thị, không thay đổi confidence/score.
export function provenanceLabel(source: unknown): string {
  if (source === "auto_enrichment") return "Tự động phân tích";
  if (source === "manual_check") return "Đã kiểm tra thủ công";
  return "";
}

// Logic core cho công việc scan -> enrollment: non-blocking, no AI.
export function planAutoEnrollmentForRows(args: {
  plan: string | null | undefined;
  killSwitch: boolean;
  costGuard: boolean;
  existingStatus: Record<string, { status: AutoEnrollmentStatus | null | undefined; hash: string | null | undefined; updatedAt: string | null | undefined }>;
  rows: Record<string, unknown>[];
  allowanceRemaining: number;
  nowMs: number;
}) {
  const out: Array<{ row: Record<string, unknown>; hash: string; input: Record<string, number | string | null> }> = [];
  if (args.killSwitch) return out;
  if (args.costGuard) return out;
  if (args.plan !== "pro") return out;

  for (const row of args.rows) {
    const input = materialInputFromRow(row);
    if (!isMinimumMaterialAvailable(input)) continue;
    const hash = materialFingerprint(input);
    const existing = args.existingStatus[String(row.external_id ?? "")];
    const status = existing?.status ?? null;
    const isNewOrChanged = !existing || existing.hash !== hash;
    const stale = existing?.updatedAt ? isStale(existing.updatedAt, args.nowMs) : true;
    const isActive = status === "pending" || status === "processing";
    const isTerminal =
      status === "completed" ||
      status === "insufficient_data" ||
      status === "low_confidence" ||
      status === "failed";
    const canEnqueue =
      !existing ||
      status === null ||
      (isActive ? false : isTerminal ? (isNewOrChanged || stale) : true);

    if (!canEnqueue) continue;
    if (args.allowanceRemaining <= out.length) break;
    if (out.length >= AUTO_ENRICHMENT_PER_RADAR_CAP) break;
    out.push({ row, hash, input });
  }
  return out;
}

export function isManualCheckWinnerOk(createdAt: unknown, dispatchStartedAt: string | null | undefined): boolean {
  if (!dispatchStartedAt) return false;
  const start = Date.parse(dispatchStartedAt);
  if (Number.isNaN(start)) return false;
  return typeof createdAt === "string" && Date.parse(createdAt) > start;
}

// Wording UI theo đúng state — pending TUYỆT ĐỐI không phải "Đang phân tích"
// (AI chưa dispatch thì chưa phân tích).
const STATUS_LABELS: Record<AutoEnrollmentStatus, string> = {
  not_started: "",
  pending: "Chờ phân tích",
  processing: "Đang phân tích",
  completed: "Đã chấm",
  insufficient_data: "Không đủ dữ liệu",
  low_confidence: "Độ tin cậy thấp",
  failed: "Phân tích thất bại",
};

export function enrichmentStatusLabel(status: AutoEnrollmentStatus): string {
  return STATUS_LABELS[status] ?? "";
}

/** Placeholder "Đang phân tích" CHỈ khi AI đã dispatch (processing).
 *  pending = chờ phân tích, chưa có AI nào chạy. */
export function shouldShowProcessingPlaceholder(args: {
  scoringAvailable: boolean;
  status: AutoEnrollmentStatus | null | undefined;
}): boolean {
  return !args.scoringAvailable && args.status === "processing";
}

