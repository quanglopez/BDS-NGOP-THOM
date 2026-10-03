// Auto-Enrichment worker: nhận job pending -> claim -> charge allowance tại
// dispatch -> gọi provider -> validate/confidence -> persist -> terminal.
//
// Nguyên tắc:
// - Charge đúng 1 lần khi dispatch ĐẦU TIÊN bắt đầu; retry không charge thêm.
// - Cap ngày 200 (atomic trong RPC begin_auto_enrichment_dispatch), cap 25/Radar ở enqueue.
// - Retry tối đa 3 attempt (1 đầu + 2 retry), chỉ với lỗi retryable; backoff + jitter.
// - Manual Check mới hơn dispatch -> auto không publish signal (guard tại persistence).
// - Mọi lỗi 1 job không làm sập cả run.

import {
  backOffMs,
  isManualCheckWinnerOk,
  shouldRetry,
  type AutoProviderOutcome,
} from "./auto-enrollment";
import type { EnrichmentProvider } from "./enrichment-provider";

export type EnrichmentTerminalStatus = "completed" | "insufficient_data" | "low_confidence" | "failed";

export interface EnrichmentJobRow {
  id: string;
  user_id: string;
  radar_id: string;
  external_id: string;
  material_input: Record<string, unknown>;
  material_input_hash: string;
  attempts: number;
  dispatch_started_at: string | null;
  claim_token: string | null;
  /** Thời điểm tạo job (cột created_at, `not null default now()`). Là thứ tự
   *  "job nào mới hơn": material đổi -> `syncEnrichmentJobs` tạo job MỚI, nên
   *  job tạo sau luôn phản ánh material mới hơn. Dùng để guard takeover
   *  ownership của radar_matches (P1-1). RPC claim trả `returning j.*` nên
   *  luôn có giá trị. */
  created_at: string;
}

export interface MatchEnrichmentPatch {
  status: EnrichmentTerminalStatus;
  source: "auto_enrichment";
  score: number | null;
  dealType: string | null;
  isNgoP: number | null;
  confidence: "low" | "medium" | "high" | null;
  checkedAt: string;
}

export interface EnrichmentWorkerStore {
  reclaimStaleProcessing(cutoffISO: string, maxAttempts: number): Promise<{ requeued: number; failed: number }>;
  claimPending(limit: number): Promise<EnrichmentJobRow[]>;
  isPlanPro(userId: string): Promise<boolean>;
  beginDispatch(job: EnrichmentJobRow): Promise<boolean>;
  /** false = CAS không khớp (row do job khác sở hữu / đã có kết quả). */
  markMatchProcessing(job: EnrichmentJobRow): Promise<boolean>;
  releaseToPending(
    job: EnrichmentJobRow,
    patch: { nextAttemptAt: string; updatedAt: string; errorKind: string; lastError: string },
  ): Promise<void>;
  markTerminal(
    job: EnrichmentJobRow,
    status: EnrichmentTerminalStatus,
    error?: { errorKind: string; lastError: string },
  ): Promise<void>;
  latestManualCheckAt(externalId: string): Promise<string | null>;
  persistMatchEnrichment(job: EnrichmentJobRow, patch: MatchEnrichmentPatch): Promise<boolean>;
}

export interface EnrichmentWorkerResult {
  ok: boolean;
  claimed: number;
  published: number;
  manualWins: number;
  insufficient: number;
  lowConfidence: number;
  failed: number;
  retried: number;
  capBlocked: number;
  planBlocked: number;
  lostClaims: number;
  errors: string[];
}

export const ENRICHMENT_WORKER_LIMITS = {
  maxJobs: 5,
  maxAttempts: 3,
  leaseMs: 10 * 60 * 1000,
  capRetryMs: 60 * 60 * 1000,
};

/** Config mà cron route chạy (1 lần/ngày). Tách riêng để test khoá được giá
 *  trị production mà không phải export thêm từ route (Next chỉ cho export handler). */
export const ENRICHMENT_ROUTE_LIMITS = ENRICHMENT_WORKER_LIMITS;

/** Cờ dừng trước khi claim/charge. kill switch dừng hẳn; cost guard chặn dispatch. */
export function workerSkipReason(env: Record<string, string | undefined>): "kill_switch" | "cost_guard" | null {
  if (env.AUTO_ENRICHMENT_KILL_SWITCH === "1") return "kill_switch";
  if (env.AUTO_ENRICHMENT_COST_GUARD === "1") return "cost_guard";
  return null;
}

function errName(e: unknown): string {
  return e instanceof Error ? e.name : "unknown_error";
}

export async function runEnrichmentWorker(args: {
  store: EnrichmentWorkerStore;
  provider: EnrichmentProvider;
  now?: () => number;
  limits?: Partial<typeof ENRICHMENT_WORKER_LIMITS>;
}): Promise<EnrichmentWorkerResult> {
  const nowFn = args.now ?? Date.now;
  const limits = { ...ENRICHMENT_WORKER_LIMITS, ...args.limits };
  const result: EnrichmentWorkerResult = {
    ok: true,
    claimed: 0,
    published: 0,
    manualWins: 0,
    insufficient: 0,
    lowConfidence: 0,
    failed: 0,
    retried: 0,
    capBlocked: 0,
    planBlocked: 0,
    lostClaims: 0,
    errors: [],
  };

  // Job processing mồ côi (worker crash) -> trả về pending nếu còn lượt, hết lượt -> failed.
  try {
    await args.store.reclaimStaleProcessing(
      new Date(nowFn() - limits.leaseMs).toISOString(),
      limits.maxAttempts,
    );
  } catch (e) {
    result.errors.push("reclaim:" + errName(e));
  }

  let jobs: EnrichmentJobRow[];
  try {
    jobs = await args.store.claimPending(limits.maxJobs);
  } catch (e) {
    result.errors.push("claim:" + errName(e));
    return result;
  }
  result.claimed = jobs.length;

  for (const job of jobs) {
    if (!job.claim_token) continue;
    try {
      const firstDispatch = job.dispatch_started_at == null;
      const startedAt = new Date(nowFn()).toISOString();

      // PRO-only end-to-end: user hết hạn giữa lúc enqueue và dispatch -> không tiêu tiền AI.
      if (!(await args.store.isPlanPro(job.user_id))) {
        await args.store.markTerminal(job, "failed", { errorKind: "plan_inactive", lastError: "plan_inactive" });
        result.planBlocked++;
        continue;
      }

      // Atomic tại DB: charge allowance (lần đầu) + tăng attempts. false = cap/stale claim.
      const started = await args.store.beginDispatch(job);
      if (!started) {
        if (firstDispatch) {
          await args.store.releaseToPending(job, {
            nextAttemptAt: new Date(nowFn() + limits.capRetryMs).toISOString(),
            updatedAt: startedAt,
            errorKind: "daily_cap",
            lastError: "daily_cap",
          });
          result.capBlocked++;
        } else {
          result.lostClaims++;
        }
        continue;
      }
      const attempts = job.attempts + 1;

      // Đã dispatch -> AI đang chạy: đưa radar_matches sang processing để UI báo
      // "Đang phân tích". false = row đang do job KHÁC sở hữu và job đó MỚI HƠN
      // (job cũ của fingerprint cũ) -> tiếp tục chạy nhưng ghi kết quả sẽ bị CAS
      // chặn, KHÔNG được coi là đã ghi được processing.
      // Job có fingerprint KHÁC nhưng tạo SAU (material đã đổi) thì vẫn chiếm được
      // row — guard theo created_at, xem enrichment-store.markMatchProcessing.
      let ownsRow = false;
      try {
        ownsRow = await args.store.markMatchProcessing(job);
        // Row đang do job khác sở hữu -> không được coi là đã ghi processing.
        if (!ownsRow) result.lostClaims++;
      } catch (e) {
        result.errors.push(job.id + ":mark_processing:" + errName(e));
      }
      // ownsRow=false vẫn chạy tiếp: kết quả sẽ bị CAS của persistMatchEnrichment
      // chặn, job vẫn terminal -> không mất job, không ghi đè row của job khác.

      let outcome: AutoProviderOutcome;
      try {
        outcome = await args.provider(job.material_input);
      } catch {
        outcome = { kind: "retryable_error" };
      }

      if (outcome.kind === "published") {
        const manualAt = await args.store.latestManualCheckAt(job.external_id);
        const manualWins = isManualCheckWinnerOk(manualAt, job.dispatch_started_at ?? startedAt);
        const checkedAt = new Date(nowFn()).toISOString();
        const wrote = await args.store.persistMatchEnrichment(
          job,
          manualWins
            ? { status: "completed", source: "auto_enrichment", score: null, dealType: null, isNgoP: null, confidence: null, checkedAt }
            : { status: "completed", source: "auto_enrichment", score: outcome.score, dealType: outcome.dealType, isNgoP: outcome.isNgoP, confidence: outcome.confidence, checkedAt },
        );
        // CAS không khớp (row đã sang job khác) -> job vẫn terminal nhưng KHÔNG báo
        // publish: che mất việc mất ownership cũng là sai.
        await args.store.markTerminal(job, "completed");
        if (!wrote) result.lostClaims++;
        else if (manualWins) result.manualWins++;
        else result.published++;
        continue;
      }

      if (outcome.kind === "insufficient_data" || outcome.kind === "low_confidence") {
        const status = outcome.kind;
        const wrote = await args.store.persistMatchEnrichment(job, {
          status,
          source: "auto_enrichment",
          score: null,
          dealType: null,
          isNgoP: null,
          confidence: status === "low_confidence" ? "low" : null,
          checkedAt: new Date(nowFn()).toISOString(),
        });
        await args.store.markTerminal(job, status);
        if (!wrote) result.lostClaims++;
        else if (status === "low_confidence") result.lowConfidence++;
        else result.insufficient++;
        continue;
      }

      // Retry không charge thêm. Job mất ownership vẫn terminal bình thường, chỉ là
      // không ghi được vào radar_matches (CAS chặn) — KHÔNG giả vờ đã ghi.
      if (outcome.kind === "retryable_error" && shouldRetry(outcome, attempts)) {
        await args.store.releaseToPending(job, {
          nextAttemptAt: new Date(nowFn() + backOffMs(attempts)).toISOString(),
          updatedAt: new Date(nowFn()).toISOString(),
          errorKind: "retryable_error",
          lastError: "retryable_error",
        });
        result.retried++;
        continue;
      }

      const wroteFailed = await args.store.persistMatchEnrichment(job, {
        status: "failed",
        source: "auto_enrichment",
        score: null,
        dealType: null,
        isNgoP: null,
        confidence: null,
        checkedAt: new Date(nowFn()).toISOString(),
      });
      await args.store.markTerminal(job, "failed", { errorKind: outcome.kind, lastError: outcome.kind });
      // Job terminal nhưng row đang của job khác -> không ghi đè, không tính failed.
      if (!wroteFailed) result.lostClaims++;
      else result.failed++;
    } catch (e) {
      result.errors.push(job.id + ":" + errName(e));
    }
  }
  return result;
}
