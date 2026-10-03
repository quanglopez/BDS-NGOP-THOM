// Self-check: Auto-Enrichment WORKER runtime + provider mapping + migration static.
// Không network, không DB thật: MemStore mô phỏng đúng semantics của RPC
// (claim SKIP LOCKED, charge atomic theo cap, claim token) + provider stub.
// MANDATORY tags theo danh sách Factory review.
import assert from "node:assert/strict";
import {
  runEnrichmentWorker,
  workerSkipReason,
  ENRICHMENT_WORKER_LIMITS,
  type EnrichmentJobRow,
  type EnrichmentWorkerStore,
  type MatchEnrichmentPatch,
} from "@/lib/radar/enrichment-worker";
import {
  createJevEnrichmentProvider,
  mapEnrichmentAnswers,
  buildEnrichmentState,
  type EnrichmentProvider,
} from "@/lib/radar/enrichment-provider";
import type { AutoProviderOutcome } from "@/lib/radar/auto-enrollment";

const USER = "user-1";
const T0 = Date.parse("2026-10-03T02:00:00.000Z");
const MIN = 60 * 1000;

type JobStatus = "pending" | "processing" | "completed" | "insufficient_data" | "low_confidence" | "failed";
type StoredJob = EnrichmentJobRow & {
  status: JobStatus;
  next_attempt_at: string | null;
  processing_started_at: string | null;
  allowance_consumed: boolean;
  error_kind: string | null;
  last_error: string | null;
  updated_at: string;
};

/** Mô phỏng DB: claim = CAS theo status; charge = atomic cap; claim token chống double. */
class MemStore implements EnrichmentWorkerStore {
  nowMs = T0;
  dailyLimit = 200;
  jobs: StoredJob[] = [];
  matches = new Map<string, { score: number | null; deal_type: string | null; is_ngop: number | null; enrichment: Partial<MatchEnrichmentPatch> }>();
  checks: { external_id: string; created_at: string; score: number | null }[] = [];
  plans = new Map<string, boolean>();
  allowance = new Map<string, number>();
  charges: string[] = [];
  dispatches = 0;
  persistCalls: { jobId: string; patch: MatchEnrichmentPatch }[] = [];
  processingCalls: EnrichmentJobRow[] = [];
  providerInputs: Record<string, unknown>[] = [];

  private iso() {
    return new Date(this.nowMs).toISOString();
  }

  seedJob(over: Partial<StoredJob> = {}): StoredJob {
    const job: StoredJob = {
      id: "job-" + (this.jobs.length + 1),
      user_id: USER,
      radar_id: "radar-1",
      external_id: "111",
      material_input: { title: "Tin 111", price_vnd: 5_000_000_000, size_m2: 50 },
      material_input_hash: "hash-111",
      attempts: 0,
      dispatch_started_at: null,
      claim_token: null,
      status: "pending",
      next_attempt_at: null,
      processing_started_at: null,
      allowance_consumed: false,
      error_kind: null,
      last_error: null,
      updated_at: this.iso(),
      ...over,
    };
    this.jobs.push(job);
    return job;
  }

  seedMatch(externalId = "111", over: { score?: number | null; deal_type?: string | null; is_ngop?: number | null } = {}) {
    this.matches.set(externalId, { score: null, deal_type: null, is_ngop: null, ...over, enrichment: {} });
  }

  async reclaimStaleProcessing(cutoffISO: string, maxAttempts: number) {
    let requeued = 0;
    let failed = 0;
    for (const j of this.jobs) {
      if (j.status !== "processing" || j.processing_started_at == null || j.processing_started_at >= cutoffISO) continue;
      if (j.attempts < maxAttempts) {
        j.status = "pending";
        j.claim_token = null;
        j.processing_started_at = null;
        j.next_attempt_at = this.iso();
        j.error_kind = "lease_expired";
        requeued++;
      } else {
        j.status = "failed";
        j.claim_token = null;
        j.processing_started_at = null;
        j.error_kind = "lease_expired";
        failed++;
      }
    }
    return { requeued, failed };
  }

  async claimPending(limit: number) {
    const out: EnrichmentJobRow[] = [];
    for (const j of this.jobs) {
      if (out.length >= limit) break;
      if (j.status !== "pending") continue;
      if (j.next_attempt_at && j.next_attempt_at > this.iso()) continue;
      j.status = "processing";
      j.claim_token = "token-" + j.id;
      j.processing_started_at = this.iso();
      out.push({ ...j });
    }
    return out;
  }

  async isPlanPro(userId: string) {
    return this.plans.get(userId) === true;
  }

  async beginDispatch(job: EnrichmentJobRow) {
    const j = this.jobs.find((x) => x.id === job.id && x.claim_token === job.claim_token && x.status === "processing");
    if (!j) return false;
    if (j.dispatch_started_at == null) {
      const day = this.iso().slice(0, 10);
      const key = j.user_id + "|" + day;
      const used = this.allowance.get(key) ?? 0;
      if (used >= this.dailyLimit) return false;
      this.allowance.set(key, used + 1);
      j.dispatch_started_at = this.iso();
      j.allowance_consumed = true;
      this.charges.push(j.id);
    }
    j.attempts += 1;
    return true;
  }

  async releaseToPending(job: EnrichmentJobRow, patch: { nextAttemptAt: string; updatedAt: string; errorKind: string; lastError: string }) {
    const j = this.jobs.find((x) => x.id === job.id);
    if (!j) return;
    j.status = "pending";
    j.claim_token = null;
    j.processing_started_at = null;
    j.next_attempt_at = patch.nextAttemptAt;
    j.error_kind = patch.errorKind;
    j.last_error = patch.lastError;
    j.updated_at = patch.updatedAt;
  }

  async markTerminal(job: EnrichmentJobRow, status: "completed" | "insufficient_data" | "low_confidence" | "failed", error?: { errorKind: string; lastError: string }) {
    const j = this.jobs.find((x) => x.id === job.id);
    if (!j) return;
    j.status = status;
    j.claim_token = null;
    j.processing_started_at = null;
    j.error_kind = error?.errorKind ?? null;
    j.last_error = error?.lastError ?? null;
    j.updated_at = this.iso();
  }

  async latestManualCheckAt(externalId: string) {
    const list = this.checks
      .filter((c) => c.external_id === externalId && c.score != null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return list[0]?.created_at ?? null;
  }

  async markMatchProcessing(job: EnrichmentJobRow) {
    this.processingCalls.push(job);
    const m = this.matches.get(job.external_id);
    if (m) m.enrichment = { ...m.enrichment, status: "processing" };
  }

  async persistMatchEnrichment(job: EnrichmentJobRow, patch: MatchEnrichmentPatch) {
    this.persistCalls.push({ jobId: job.id, patch });
    const m = this.matches.get(job.external_id);
    if (m) m.enrichment = { ...patch };
  }
}

const PUBLISHED: AutoProviderOutcome = { kind: "published", score: 82, dealType: "ngop_ngon", isNgoP: 88, confidence: "high" };

function providerFrom(
  store: MemStore,
  outcome: AutoProviderOutcome | AutoProviderOutcome[] | (() => AutoProviderOutcome),
): EnrichmentProvider {
  const queue = Array.isArray(outcome) ? [...outcome] : null;
  return async (input) => {
    store.dispatches++;
    store.providerInputs.push(input);
    if (queue) return queue.shift() ?? { kind: "retryable_error" };
    return typeof outcome === "function" ? outcome() : outcome;
  };
}

function runWorker(store: MemStore, provider: EnrichmentProvider, limits?: Partial<typeof ENRICHMENT_WORKER_LIMITS>) {
  return runEnrichmentWorker({ store, provider, now: () => store.nowMs, limits });
}

function setup(over: { plan?: boolean; dailyLimit?: number; consumed?: number } = {}) {
  const store = new MemStore();
  store.plans.set(USER, over.plan ?? true);
  if (over.dailyLimit != null) store.dailyLimit = over.dailyLimit;
  if (over.consumed) store.allowance.set(USER + "|" + new Date(store.nowMs).toISOString().slice(0, 10), over.consumed);
  store.seedMatch("111");
  return store;
}

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------- happy path

await test("MANDATORY 1/2/3/12. claim pending -> processing -> completed; charge đúng 1 tại dispatch", async () => {
  const store = setup();
  const job = store.seedJob();
  let statusDuringCall: string | null = null;
  const provider: EnrichmentProvider = async () => {
    store.dispatches++;
    statusDuringCall = job.status;
    return PUBLISHED;
  };
  const res = await runWorker(store, provider);

  assert.equal(res.claimed, 1);
  assert.equal(res.published, 1);
  assert.equal(statusDuringCall, "processing", "provider phải thấy job đang processing");
  assert.equal(job.status, "completed");
  assert.equal(job.attempts, 1);
  assert.deepEqual(store.charges, [job.id], "dispatch đầu tiên charge đúng 1");
  assert.equal(job.allowance_consumed, true);
  assert.ok(job.dispatch_started_at, "dispatch_started_at phải được set");

  const patch = store.persistCalls[0]!.patch;
  assert.equal(patch.status, "completed");
  assert.equal(patch.source, "auto_enrichment");
  assert.equal(patch.score, 82);
  assert.equal(patch.dealType, "ngop_ngon");
  assert.equal(patch.isNgoP, 88);
  assert.equal(patch.confidence, "high");
  assert.equal(store.matches.get("111")!.enrichment.status, "completed");
  assert.equal(res.errors.length, 0);
});

await test("MANDATORY 30b. FIX 2: đã dispatch thì radar_matches = processing TRƯỚC khi persist terminal", async () => {
  const store = setup();
  store.seedJob();
  const order: string[] = [];
  const provider: EnrichmentProvider = async () => {
    order.push("provider");
    return PUBLISHED;
  };
  const origMark = store.markMatchProcessing.bind(store);
  const origPersist = store.persistMatchEnrichment.bind(store);
  store.markMatchProcessing = async (j) => {
    order.push("mark_processing");
    return origMark(j);
  };
  store.persistMatchEnrichment = async (j, p) => {
    order.push("persist:" + p.status);
    return origPersist(j, p);
  };
  await runWorker(store, provider);
  assert.deepEqual(order, ["mark_processing", "provider", "persist:completed"], "thứ tự phải là processing -> gọi AI -> terminal");
  assert.deepEqual(store.processingCalls.map((j) => j.id), [store.jobs[0]!.id]);
});

await test("FIX 2: đánh dấu processing KHÔNG fabricate score (giữ null của lần trước)", async () => {
  const store = setup();
  store.seedMatch("111", { score: null, deal_type: null, is_ngop: null });
  store.matches.get("111")!.enrichment = { score: null, dealType: null, isNgoP: null };
  store.seedJob();
  await runWorker(store, providerFrom(store, { kind: "retryable_error" }));
  const m = store.matches.get("111")!;
  assert.equal(m.enrichment.status, "processing");
  assert.equal(m.enrichment.score, null);
  assert.equal(m.enrichment.dealType, null);
  assert.equal(m.enrichment.isNgoP, null);
  assert.notEqual(m.enrichment.score, 0);
  assert.equal(m.score, null, "không chạm cột manual");
});

await test("FIX 2: lỗi ghi processing KHÔNG làm mất job (vẫn dispatch + terminal)", async () => {
  const store = setup();
  store.seedJob();
  const job = store.jobs[0]!;
  store.markMatchProcessing = async () => {
    throw new Error("db write failed");
  };
  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(res.published, 1, "job vẫn phải chạy tới terminal");
  assert.equal(job.status, "completed");
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0]!, /mark_processing/);
});

await test("FIX 2: cap/plan blocked KHÔNG ghi processing (AI chưa chạy)", async () => {
  const blocked = setup({ consumed: 200 });
  blocked.seedJob();
  const resBlocked = await runWorker(blocked, providerFrom(blocked, PUBLISHED));
  assert.equal(resBlocked.capBlocked, 1);
  assert.deepEqual(blocked.processingCalls, [], "chưa dispatch thì không được hiện 'Đang phân tích'");

  const noPlan = setup({ plan: false });
  noPlan.seedJob();
  await runWorker(noPlan, providerFrom(noPlan, PUBLISHED));
  assert.deepEqual(noPlan.processingCalls, []);
});

// ---------------------------------------------------------------- terminal outcomes

await test("MANDATORY 4/26. insufficient_data terminal: không retry, charge 1, publish null", async () => {
  const store = setup();
  const job = store.seedJob();
  const res = await runWorker(store, providerFrom(store, { kind: "insufficient_data" }));

  assert.equal(res.insufficient, 1);
  assert.equal(res.retried, 0);
  assert.equal(job.status, "insufficient_data");
  assert.equal(store.dispatches, 1);
  assert.deepEqual(store.charges, [job.id]);
  const patch = store.persistCalls[0]!.patch;
  assert.equal(patch.status, "insufficient_data");
  assert.equal(patch.score, null);
  assert.equal(patch.dealType, null);
  assert.equal(patch.isNgoP, null);
  assert.equal(patch.confidence, null);
  assert.equal(store.matches.get("111")!.enrichment.score, null);
});

await test("MANDATORY 5/25. low_confidence terminal: không retry, charge 1, không publish signal", async () => {
  const store = setup();
  const job = store.seedJob();
  const res = await runWorker(store, providerFrom(store, { kind: "low_confidence" }));

  assert.equal(res.lowConfidence, 1);
  assert.equal(res.retried, 0);
  assert.equal(job.status, "low_confidence");
  assert.equal(store.dispatches, 1);
  assert.deepEqual(store.charges, [job.id]);
  const patch = store.persistCalls[0]!.patch;
  assert.equal(patch.status, "low_confidence");
  assert.equal(patch.score, null);
  assert.equal(patch.dealType, null);
  assert.equal(patch.isNgoP, null);
  assert.equal(patch.confidence, "low");
});

await test("terminal_error (business rejection) -> failed, không retry", async () => {
  const store = setup();
  const job = store.seedJob();
  const res = await runWorker(store, providerFrom(store, { kind: "terminal_error" }));
  assert.equal(res.failed, 1);
  assert.equal(res.retried, 0);
  assert.equal(job.status, "failed");
  assert.equal(store.dispatches, 1);
});

// ---------------------------------------------------------------- retry

await test("MANDATORY 6/7/10/11. retryable: 3 dispatch, chỉ charge 1, hết retry -> failed", async () => {
  const store = setup();
  const job = store.seedJob();
  const provider = providerFrom(store, { kind: "retryable_error" });

  const r1 = await runWorker(store, provider);
  assert.equal(r1.retried, 1);
  assert.equal(job.status, "pending");
  assert.equal(job.attempts, 1);
  assert.ok(job.next_attempt_at && Date.parse(job.next_attempt_at) > store.nowMs, "retry phải lùi lịch");
  assert.deepEqual(store.charges, [job.id]);

  store.nowMs += 10 * MIN;
  const r2 = await runWorker(store, provider);
  assert.equal(r2.retried, 1);
  assert.equal(job.attempts, 2);

  store.nowMs += 10 * MIN;
  const r3 = await runWorker(store, provider);
  assert.equal(r3.failed, 1, "attempt 3 thất bại -> terminal failed");
  assert.equal(job.status, "failed");
  assert.equal(job.attempts, 3);
  assert.equal(store.dispatches, 3, "đúng 1 đầu + 2 retry");
  assert.deepEqual(store.charges, [job.id], "retry KHÔNG charge thêm");

  const r4 = await runWorker(store, provider);
  assert.equal(r4.claimed, 0, "job failed không được claim lại");
  assert.equal(store.dispatches, 3);
});

await test("MANDATORY 7. provider throw (timeout/mạng sập) -> retry, charge 1", async () => {
  const store = setup();
  const job = store.seedJob();
  const provider: EnrichmentProvider = async () => {
    store.dispatches++;
    throw new Error("timeout");
  };
  const res = await runWorker(store, provider);
  assert.equal(res.retried, 1);
  assert.equal(job.status, "pending");
  assert.equal(store.charges.length, 1);
});

// ---------------------------------------------------------------- cap / charge

await test("MANDATORY 13/14. cap ngày: 199 -> charge, 200 -> chặn trước dispatch, không charge", async () => {
  const blocked = setup({ consumed: 200 });
  const jb = blocked.seedJob();
  const resBlocked = await runWorker(blocked, providerFrom(blocked, PUBLISHED));
  assert.equal(resBlocked.capBlocked, 1);
  assert.equal(blocked.charges.length, 0, "cap chặn -> không charge");
  assert.equal(blocked.dispatches, 0, "cap chặn -> không gọi AI");
  assert.equal(jb.status, "pending", "cap chặn -> job quay về pending");
  assert.equal(jb.dispatch_started_at, null);
  assert.ok(jb.next_attempt_at && Date.parse(jb.next_attempt_at) > blocked.nowMs);

  const ok = setup({ consumed: 199 });
  const jo = ok.seedJob();
  const resOk = await runWorker(ok, providerFrom(ok, PUBLISHED));
  assert.equal(resOk.published, 1);
  assert.deepEqual(ok.charges, [jo.id]);
});

await test("MANDATORY 16. hai worker đồng thời: cap 1 -> đúng 1 charge, không double", async () => {
  const store = setup({ dailyLimit: 1 });
  const a = store.seedJob({ id: "job-a" });
  const b = store.seedJob({ id: "job-b", external_id: "222" });
  store.seedMatch("222");

  let active = 0;
  let maxActive = 0;
  const provider: EnrichmentProvider = async () => {
    store.dispatches++;
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return PUBLISHED;
  };
  const [ra, rb] = await Promise.all([runWorker(store, provider), runWorker(store, provider)]);

  assert.equal(store.charges.length, 1, "cap 1: tổng charge đúng 1");
  assert.equal(new Set(store.charges).size, store.charges.length, "không double charge 1 job");
  assert.equal(store.dispatches, 1, "chỉ 1 job được dispatch");
  assert.equal(ra.capBlocked + rb.capBlocked, 1);
  assert.equal(ra.published + rb.published, 1);
  assert.equal(maxActive, 1);
  assert.equal([a.status, b.status].filter((s) => s === "completed").length, 1);
  assert.equal([a.status, b.status].filter((s) => s === "pending").length, 1);
});

// ---------------------------------------------------------------- plan / guards

await test("MANDATORY 19. PRO-only end-to-end: mất plan trước dispatch -> không charge, không gọi AI", async () => {
  const store = setup({ plan: false });
  const job = store.seedJob();
  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(res.planBlocked, 1);
  assert.equal(store.charges.length, 0);
  assert.equal(store.dispatches, 0);
  assert.equal(job.status, "failed");
  assert.equal(job.error_kind, "plan_inactive");
});

await test("MANDATORY 17/18. workerSkipReason: kill switch và cost guard", () => {
  assert.equal(workerSkipReason({}), null);
  assert.equal(workerSkipReason({ AUTO_ENRICHMENT_KILL_SWITCH: "1" }), "kill_switch");
  assert.equal(workerSkipReason({ AUTO_ENRICHMENT_COST_GUARD: "1" }), "cost_guard");
  assert.equal(workerSkipReason({ AUTO_ENRICHMENT_KILL_SWITCH: "0", AUTO_ENRICHMENT_COST_GUARD: "0" }), null);
});

// ---------------------------------------------------------------- manual race

await test("MANDATORY 30. manual Check mới hơn dispatch -> auto KHÔNG publish signal, cột manual nguyên vẹn", async () => {
  const store = setup();
  const dispatchAt = new Date(T0 - 10 * MIN).toISOString();
  const job = store.seedJob({ dispatch_started_at: dispatchAt, allowance_consumed: true, attempts: 1 });
  store.seedMatch("111", { score: 77, deal_type: "thom_dau_tu", is_ngop: 91 });
  store.checks.push({ external_id: "111", created_at: new Date(T0 - 5 * MIN).toISOString(), score: 77 });

  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(res.manualWins, 1);
  assert.equal(res.published, 0);
  assert.equal(store.charges.length, 0, "job đã dispatch trước đó -> không charge lại");

  const patch = store.persistCalls[0]!.patch;
  assert.equal(patch.status, "completed");
  assert.equal(patch.score, null, "auto không được publish score khi manual mới hơn");
  assert.equal(patch.dealType, null);
  assert.equal(patch.isNgoP, null);
  const m = store.matches.get("111")!;
  assert.equal(m.score, 77, "cột manual không bị đụng");
  assert.equal(m.deal_type, "thom_dau_tu");
  assert.equal(m.is_ngop, 91);
  assert.equal(m.enrichment.score, null);
  assert.equal(job.status, "completed");
});

await test("manual Check cũ hơn dispatch -> auto publish bình thường", async () => {
  const store = setup();
  const job = store.seedJob({ dispatch_started_at: new Date(T0 - 10 * MIN).toISOString(), allowance_consumed: true, attempts: 1 });
  store.seedMatch("111", { score: 55, deal_type: "gia_cao", is_ngop: 20 });
  store.checks.push({ external_id: "111", created_at: new Date(T0 - 20 * MIN).toISOString(), score: 55 });

  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(res.published, 1);
  assert.equal(res.manualWins, 0);
  assert.equal(store.persistCalls[0]!.patch.score, 82);
  assert.equal(store.matches.get("111")!.score, 55, "manual cũ vẫn không bị ghi đè");
});

await test("MANDATORY 31. persistence boundary chỉ ghi enrichment_* — không có key manual", async () => {
  const store = setup();
  store.seedJob();
  await runWorker(store, providerFrom(store, PUBLISHED));
  const patch = store.persistCalls[0]!.patch as unknown as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(patch).sort(),
    ["checkedAt", "confidence", "dealType", "isNgoP", "score", "source", "status"],
    "patch không được chứa score/deal_type/is_ngop của manual",
  );
  assert.equal("deal_type" in patch, false);
  assert.equal("is_ngop" in patch, false);
});

// ---------------------------------------------------------------- null semantics

await test("MANDATORY 27/28/29. score=0 giữ 0; dealType/isNgoP null giữ null (không default)", async () => {
  const store = setup();
  store.seedJob();
  await runWorker(store, providerFrom(store, { kind: "published", score: 0, dealType: null, isNgoP: null, confidence: "medium" }));
  const patch = store.persistCalls[0]!.patch;
  assert.equal(patch.score, 0);
  assert.notEqual(patch.score, null);
  assert.equal(patch.dealType, null);
  assert.equal(patch.isNgoP, null);
  assert.equal(store.matches.get("111")!.enrichment.score, 0);

  const store2 = setup();
  store2.seedJob();
  await runWorker(store2, providerFrom(store2, { kind: "terminal_error" }));
  const failed = store2.persistCalls[0]!.patch;
  assert.equal(failed.score, null);
  assert.notEqual(failed.score, 0);
  assert.equal(failed.isNgoP, null);
  assert.notEqual(failed.isNgoP, 0);
});

// ---------------------------------------------------------------- crash recovery / duplicates

await test("worker crash: processing quá lease -> requeue (còn lượt) / failed (hết lượt), không charge lại", async () => {
  const store = setup();
  const stale = store.seedJob({
    id: "job-stale",
    status: "processing",
    processing_started_at: new Date(T0 - 11 * MIN).toISOString(),
    claim_token: "old",
    attempts: 1,
    dispatch_started_at: new Date(T0 - 12 * MIN).toISOString(),
    allowance_consumed: true,
  });
  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(res.claimed, 1);
  assert.equal(stale.status, "completed");
  assert.equal(stale.attempts, 2);
  assert.equal(store.charges.length, 0, "đã dispatch trước đó -> không charge lại");

  const store2 = setup();
  const dead = store2.seedJob({
    id: "job-dead",
    status: "processing",
    processing_started_at: new Date(T0 - 11 * MIN).toISOString(),
    claim_token: "old",
    attempts: 3,
  });
  const res2 = await runWorker(store2, providerFrom(store2, PUBLISHED));
  assert.equal(res2.claimed, 0);
  assert.equal(dead.status, "failed");
});

await test("MANDATORY 33. không chạy lại job đã terminal: claim lần 2 = 0, không dispatch thêm", async () => {
  const store = setup();
  store.seedJob();
  await runWorker(store, providerFrom(store, PUBLISHED));
  const again = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(again.claimed, 0);
  assert.equal(store.dispatches, 1);
});

// ---------------------------------------------------------------- provider mapping

await test("provider map: score=0 thật, null giữ null, insufficient, low, malformed", () => {
  const p0 = mapEnrichmentAnswers({ answers: { investment_potential: { score: 0 }, deal_type: { choice: "binh_thuong", confidence: 0.9 }, is_ngop: { noul: 0 } } });
  assert.equal(p0.kind, "published");
  if (p0.kind === "published") {
    assert.equal(p0.score, 0);
    assert.equal(p0.isNgoP, 0);
    assert.equal(p0.dealType, "binh_thuong");
  }

  const pNull = mapEnrichmentAnswers({ answers: { investment_potential: { score: 2 }, deal_type: { confidence: 0.9 } } });
  assert.equal(pNull.kind, "published");
  if (pNull.kind === "published") {
    assert.equal(pNull.score, 50);
    assert.equal(pNull.dealType, null);
    assert.equal(pNull.isNgoP, null);
  }

  assert.equal(mapEnrichmentAnswers({ answers: {} }).kind, "insufficient_data");
  assert.equal(
    mapEnrichmentAnswers({ answers: { investment_potential: { score: 2 }, deal_type: { choice: "ngop_ngon", confidence: 0.2 }, is_ngop: { noul: 0.5 } } }).kind,
    "low_confidence",
  );
  assert.equal(
    mapEnrichmentAnswers({ answers: { investment_potential: { score: 2 }, is_ngop: { noul: 0.5 } } }).kind,
    "low_confidence",
    "thiếu confidence -> không publish",
  );
  assert.equal(mapEnrichmentAnswers({ answers: { investment_potential: { score: -1 }, deal_type: { confidence: 0.9 } } }).kind, "retryable_error");
  assert.equal(mapEnrichmentAnswers({ answers: { is_ngop: { noul: 2 }, deal_type: { confidence: 0.9 } } }).kind, "retryable_error");
  assert.equal(mapEnrichmentAnswers("khong-phai-object").kind, "retryable_error");
});

await test("MANDATORY 8/9. provider transport: timeout/5xx/JSON hỏng -> retryable; 4xx -> terminal", async () => {
  const timeout = createJevEnrichmentProvider({ key: "k", call: async () => { throw new Error("timeout"); } });
  assert.equal((await timeout({})).kind, "retryable_error");

  const s500 = createJevEnrichmentProvider({ key: "k", call: async () => new Response("{}", { status: 502 }) });
  assert.equal((await s500({})).kind, "retryable_error");

  const s429 = createJevEnrichmentProvider({ key: "k", call: async () => new Response("{}", { status: 429 }) });
  assert.equal((await s429({})).kind, "retryable_error");

  const s400 = createJevEnrichmentProvider({ key: "k", call: async () => new Response("{}", { status: 400 }) });
  assert.equal((await s400({})).kind, "terminal_error");

  const badJson = createJevEnrichmentProvider({ key: "k", call: async () => new Response("{oops", { status: 200 }) });
  assert.equal((await badJson({})).kind, "retryable_error");

  const ok = createJevEnrichmentProvider({
    key: "k",
    call: async () =>
      new Response(
        JSON.stringify({ answers: { investment_potential: { score: 3 }, deal_type: { choice: "ngop_ngon", confidence: 0.9 }, is_ngop: { noul: 0.88 } } }),
        { status: 200 },
      ),
  });
  const out = await ok({ title: "Tin", price_vnd: 5_000_000_000, size_m2: 50 });
  assert.equal(out.kind, "published");
  if (out.kind === "published") {
    assert.equal(out.score, 75);
    assert.equal(out.isNgoP, 88);
  }
});

await test("buildEnrichmentState: chỉ material allowlist, không URL/PII", () => {
  const s = buildEnrichmentState({
    title: "Nhà 3 tầng",
    area_name: "Quận 1",
    region_name: "TP HCM",
    price_vnd: 5_000_000_000,
    size_m2: 60,
    rooms: 3,
    url: "https://example.com/tin/111.htm",
    phone: "0900000000",
  });
  assert.ok(s.includes("Nhà 3 tầng"));
  assert.ok(s.includes("Giá: 5 tỷ"));
  assert.equal(s.includes("https://"), false);
  assert.equal(s.includes("0900000000"), false);
});

// ---------------------------------------------------------------- migration static (RLS)

// Privileges/RLS/RPC/index của migration được assert chuyên sâu hơn (theo vùng
// statement + function body) trong tests/auto-enrichment-migration-sql.test.ts.

console.log(`\nradar-enrichment-worker: ${failures} fail`);
process.exitCode = failures ? 1 : 0;
