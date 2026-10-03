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

/** Trạng thái enrichment trên radar_matches: chỉ cột enrichment_* (jobId,
 *  fingerprint, tuổi của job chủ) — KHÔNG bao giờ chứa score/deal_type/is_ngop. */
type StoredEnrichment = Partial<MatchEnrichmentPatch> & { jobId?: string | null; fingerprint?: string | null; jobCreatedAt?: string | null };

/** Mô phỏng DB: claim = CAS theo status; charge = atomic cap; claim token chống double. */
class MemStore implements EnrichmentWorkerStore {
  nowMs = T0;
  /** null = đồng hồ DB đi theo nowMs. Set để mô phỏng lệch giờ app/DB. Không phải proof Postgres. */
  dbNowMs: number | null = null;
  dailyLimit = 200;
  jobs: StoredJob[] = [];
  matches = new Map<string, { score: number | null; deal_type: string | null; is_ngop: number | null; enrichment: StoredEnrichment }>();
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

  /** Giờ DB. RPC claim/reclaim/dispatch dùng now() này, không dùng giờ app. */
  private dbIso() {
    return new Date(this.dbNowMs ?? this.nowMs).toISOString();
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
      created_at: this.iso(),
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

  seedMatch(
    externalId = "111",
    over: {
      score?: number | null;
      deal_type?: string | null;
      is_ngop?: number | null;
      enrichment?: StoredEnrichment;
    } = {},
  ) {
    const { enrichment, ...manual } = over;
    this.matches.set(externalId, { score: null, deal_type: null, is_ngop: null, ...manual, enrichment: { ...enrichment } });
  }

  /** Ownership của row: job này sở hữu, HOẶC chứng minh được job đang sở hữu
   *  CỨ HƠN job này (takeover). Không chứng minh được -> false. */
  private ownsRow(e: StoredEnrichment, job: EnrichmentJobRow): boolean {
    if (e.jobId === job.id) return true;
    if (typeof job.created_at !== "string" || !(Date.parse(job.created_at) > 0)) return false;
    if (e.jobId == null || e.jobCreatedAt == null) return false;
    const owner = Date.parse(e.jobCreatedAt);
    return Number.isFinite(owner) && owner < Date.parse(job.created_at);
  }

  // Model predicate 0022: processing_started_at < dbNow - lease. Không nhận cutoff từ app.
  // ponytail: backoff cố định 30s, giống floor SQL; không phải proof Postgres.
  async reclaimStaleProcessing(leaseMs: number, maxAttempts: number) {
    const dbNow = this.dbNowMs ?? this.nowMs;
    const cutoff = dbNow - leaseMs;
    const backoffAt = new Date(dbNow + 30_000).toISOString();
    let requeued = 0;
    let failed = 0;
    for (const j of this.jobs) {
      if (j.status !== "processing" || j.processing_started_at == null) continue;
      if (Date.parse(j.processing_started_at) >= cutoff) continue;
      const dispatchAt = j.dispatch_started_at;
      if (j.attempts < maxAttempts) {
        j.status = "pending";
        j.claim_token = null;
        j.processing_started_at = null;
        j.next_attempt_at = backoffAt;
        j.error_kind = "lease_expired";
        j.dispatch_started_at = dispatchAt;
        requeued++;
      } else {
        j.status = "failed";
        j.claim_token = null;
        j.processing_started_at = null;
        j.error_kind = "lease_expired";
        j.dispatch_started_at = dispatchAt;
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
      if (j.next_attempt_at && j.next_attempt_at > this.dbIso()) continue;
      j.status = "processing";
      j.claim_token = "token-" + j.id;
      j.processing_started_at = this.dbIso();
      out.push({ ...j });
    }
    return out;
  }

  async isPlanPro(userId: string) {
    return this.plans.get(userId) === true;
  }

  async beginDispatch(job: EnrichmentJobRow) {
    const j = this.jobs.find((x) => x.id === job.id && x.claim_token === job.claim_token && x.status === "processing");
    if (!j) return null;
    if (j.dispatch_started_at == null) {
      const day = this.dbIso().slice(0, 10);
      const key = j.user_id + "|" + day;
      const used = this.allowance.get(key) ?? 0;
      if (used >= this.dailyLimit) return null;
      this.allowance.set(key, used + 1);
      j.dispatch_started_at = this.dbIso();
      j.allowance_consumed = true;
      this.charges.push(j.id);
    }
    j.attempts += 1;
    return j.dispatch_started_at;
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
    const j = this.jobs.find((x) => x.id === job.id && x.claim_token === job.claim_token && x.status === "processing");
    if (!j) return false;
    j.status = status;
    j.claim_token = null;
    j.processing_started_at = null;
    j.error_kind = error?.errorKind ?? null;
    j.last_error = error?.lastError ?? null;
    j.updated_at = this.dbIso();
    return true;
  }

  async latestManualCheckAt(externalId: string) {
    const list = this.checks
      .filter((c) => c.external_id === externalId && c.score != null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return list[0]?.created_at ?? null;
  }

  // CAS mô phỏng đúng enrichment-store: chỉ job sở hữu row (hoặc job MỚI HƠN chủ
  // hiện tại — takeover P1-1) mới ghi được.
  async markMatchProcessing(job: EnrichmentJobRow) {
    this.processingCalls.push(job);
    const m = this.matches.get(job.external_id);
    if (!m) return false;
    const e = m.enrichment;
    const status = e.status ?? null;
    const owns = e.jobId === job.id;
    const neverPublished = e.fingerprint == null && e.checkedAt == null;
    const claimable = e.jobId == null && neverPublished && (status === null || status === "not_started" || status === "pending");
    if (!owns && !claimable && !this.ownsRow(e, job)) return false;
    m.enrichment = {
      ...e,
      status: "processing",
      jobId: job.id,
      fingerprint: job.material_input_hash,
      jobCreatedAt: job.created_at,
    };
    return true;
  }

  async persistMatchEnrichment(job: EnrichmentJobRow, patch: MatchEnrichmentPatch) {
    const m = this.matches.get(job.external_id);
    // Mất ownership (hoặc job CỨ hơn chủ hiện tại) -> CAS chặn, KHÔNG ghi (và
    // KHÔNG tính vào persistCalls để test phân biệt được "đã thử ghi" với "đã ghi được").
    if (!m || !this.ownsRow(m.enrichment, job)) return false;
    this.persistCalls.push({ jobId: job.id, patch });
    m.enrichment = {
      ...patch,
      jobId: job.id,
      fingerprint: job.material_input_hash,
      jobCreatedAt: job.created_at,
    };
    return true;
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
  // Store ném khi ghi processing: job vẫn phải chạy, vẫn terminal, và vì chưa
  // sở hữu row nên persist bị CAS chặn -> KHÔNG tính publish (không giả).
  store.seedJob();
  const job = store.jobs[0]!;
  store.markMatchProcessing = async () => {
    throw new Error("db write failed");
  };
  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(job.status, "completed", "job vẫn phải chạy tới terminal");
  assert.equal(store.dispatches, 1, "vẫn dispatch AI");
  assert.equal(res.published, 0, "không sở hữu row thì không được báo publish");
  assert.equal(res.lostClaims, 1, "phải đếm mất ownership");
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0]!, /mark_processing/);
});

await test("FIX 2: markMatchProcessing trả false (CAS miss) KHÔNG đếm publish, job vẫn terminal", async () => {
  const store = setup();
  store.seedJob();
  const job = store.jobs[0]!;
  store.markMatchProcessing = async () => false;
  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(res.published, 0);
  assert.equal(store.dispatches, 0, "không sở hữu row thì không gọi provider");
  assert.equal(res.lostClaims >= 1, true);
  assert.equal(job.status, "failed", "vẫn terminal, không kẹt processing");
  assert.notEqual(job.status, "processing");
});

await test("FIX 2: mất ownership -> KHÔNG ghi đè kết quả của job khác", async () => {
  const store = setup();
  // Row đang do job khác (khác fingerprint) sở hữu và đã có kết quả.
  store.matches.get("111")!.enrichment = { status: "completed", score: 70, dealType: "thom_dau_tu", isNgoP: 30, jobId: "job-other" };
  store.seedJob();
  const job = store.jobs[0]!;
  const res = await runWorker(store, providerFrom(store, PUBLISHED));

  assert.equal(res.published, 0, "không được báo publish khi CAS không khớp");
  assert.equal(res.lostClaims >= 1, true, "phải báo mất ownership");
  assert.equal(store.dispatches, 0, "không sở hữu row thì không gọi provider");
  const m = store.matches.get("111")!;
  assert.equal(m.enrichment.status, "completed");
  assert.equal(m.enrichment.score, 70, "kết quả của job khác phải còn nguyên");
  assert.equal(m.enrichment.dealType, "thom_dau_tu");
  assert.equal(m.enrichment.jobId, "job-other");
  assert.equal(job.status, "failed", "job của ta vẫn terminal, không kẹt processing");
});

await test("FIX 2: job chiếm row pending (chưa ai sở hữu) thì ghi processing được", async () => {
  const store = setup();
  store.matches.get("111")!.enrichment = { status: "pending", jobId: undefined };
  store.seedJob();
  const job = store.jobs[0]!;
  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(res.published, 1);
  assert.equal(store.matches.get("111")!.enrichment.jobId, job.id, "row phải được gắn job.id");
});

await test("FIX 2: sau terminal, job cùng id không thể bị job khác lật ngược", async () => {
  const store = setup();
  store.seedJob({ id: "job-A" });
  await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(store.matches.get("111")!.enrichment.jobId, "job-A");

  // Job B khác fingerprint claim sau đó: không được chiếm row của A.
  store.seedJob({ id: "job-B", material_input_hash: "hash-B", status: "pending" });
  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(res.published, 0, "job B không được publish đè lên row của job A");
  const m = store.matches.get("111")!;
  assert.equal(m.enrichment.jobId, "job-A");
  assert.equal(m.enrichment.score, 82, "kết quả job A còn nguyên");
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

// ---------------------------------------------------------------- P1-1 ownership

// P1-1: material đổi -> `syncEnrichmentJobs` tạo job MỚI (id khác, hash khác).
// Job đó phải chiếm được row và publish được; allowance + lượt gọi AI của nó
// không được bỏ phí. Trước fix: ownsRow = false ở cả 2 nhánh CAS cũ, persist
// miss -> row đóng băng trên fingerprint cũ, allowance + Jev trả cho không.
await test("P1-1. job fingerprint MỚI chiếm row và publish đè kết quả cũ (không bỏ phí allowance)", async () => {
  const store = setup();
  const jobA = store.seedJob({
    id: "job-A",
    status: "completed",
    material_input_hash: "hash-A",
    attempts: 1,
    dispatch_started_at: new Date(T0 - 30 * 24 * 3600 * 1000).toISOString(),
    allowance_consumed: true,
    created_at: new Date(T0 - 31 * 24 * 3600 * 1000).toISOString(),
  });
  store.matches.get("111")!.enrichment = {
    status: "completed",
    source: "auto_enrichment",
    score: 70,
    dealType: "thom_dau_tu",
    isNgoP: 30,
    confidence: "high",
    checkedAt: new Date(T0 - 31 * 24 * 3600 * 1000).toISOString(),
    jobId: "job-A",
    fingerprint: "hash-A",
    jobCreatedAt: jobA.created_at,
  };
  // Job B: material_input_hash khác, id khác, tạo SAU job A.
  const jobB = store.seedJob({
    id: "job-B",
    status: "pending",
    material_input_hash: "hash-B",
    created_at: new Date(T0 - 60 * 60 * 1000).toISOString(),
  });

  const res = await runWorker(store, providerFrom(store, PUBLISHED));

  assert.equal(res.claimed, 1, "job A đã terminal -> chỉ job B được claim");
  assert.equal(res.published, 1, "job B phải publish được (trước fix: lostClaims, row đóng băng trên hash-A)");
  assert.equal(res.lostClaims, 0, "job B sở hữu row -> không được tính mất ownership");
  const m = store.matches.get("111")!;
  assert.equal(m.enrichment.jobId, "job-B");
  assert.equal(m.enrichment.fingerprint, "hash-B", "row phải mang fingerprint MỚI");
  assert.equal(m.enrichment.status, "completed");
  assert.equal(m.enrichment.score, 82, "kết quả của B phải thay kết quả cũ của A");
  assert.equal(m.enrichment.dealType, "ngop_ngon");
  assert.deepEqual(store.charges, ["job-B"], "allowance của B không được bỏ phí: charge đúng 1");
  assert.equal(store.dispatches, 1, "AI gọi đúng 1 lần cho B");
  assert.equal(jobB.status, "completed");
});

// Recycle TTL giữ created_at gốc (khoá payload ở radar-match.test.ts). Job A sau
// recycle không được trông mới hơn B.
await test("P1-1 residual. job A TTL-recycle giữ created_at cũ không ghi đè fingerprint của B", async () => {
  const store = setup();
  const createdA = new Date(T0 - 40 * 24 * 3600 * 1000).toISOString();
  const createdB = new Date(T0 - 60 * MIN).toISOString();
  store.matches.get("111")!.enrichment = {
    status: "completed",
    source: "auto_enrichment",
    score: 70,
    dealType: "thom_dau_tu",
    isNgoP: 30,
    confidence: "high",
    checkedAt: createdB,
    jobId: "job-B",
    fingerprint: "hash-B",
    jobCreatedAt: createdB,
  };
  const jobA = store.seedJob({
    id: "job-A",
    status: "pending",
    material_input_hash: "hash-A",
    created_at: createdA,
    attempts: 0,
    dispatch_started_at: null,
  });
  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(jobA.created_at, createdA, "recycle không được làm A trẻ lại");
  assert.equal(res.published, 0);
  assert.equal(store.dispatches, 0, "A không sở hữu row -> không gọi provider");
  const m = store.matches.get("111")!;
  assert.equal(m.enrichment.fingerprint, "hash-B");
  assert.equal(m.enrichment.score, 70);
  assert.equal(m.enrichment.jobId, "job-B");
  assert.equal(jobA.status, "failed", "A vẫn terminal, không kẹt processing");
});

// P1-1 (ngược): job A đang bay (fingerprint cũ) thì material đổi, job B chiếm
// row và publish. Khi A chạy xong, nó KHÔNG được ghi đè kết quả của B.
await test("P1-1 (ngược). worker cũ của fingerprint A không ghi đè được kết quả của B", async () => {
  const store = setup();
  store.seedJob({ id: "job-A", status: "pending", material_input_hash: "hash-A", created_at: new Date(T0 - 60 * 60 * 1000).toISOString() });

  let bPublished = false;
  const providerB = providerFrom(store, PUBLISHED);
  const provider: EnrichmentProvider = async () => {
    store.dispatches++;
    if (!bPublished) {
      // Trong lúc A đang gọi AI: material đổi -> job B (mới hơn) chiếm row + publish.
      bPublished = true;
      const jobB = store.seedJob({ id: "job-B", status: "pending", material_input_hash: "hash-B", created_at: new Date(T0 - 60_000).toISOString() });
      const [claimedB] = await store.claimPending(1);
      assert.equal(claimedB.id, "job-B", "job A đang processing nên chỉ B được claim");
      assert.equal(await store.isPlanPro(USER), true);
      assert.equal(typeof await store.beginDispatch(claimedB), "string", "B phải charge allowance và nhận mốc dispatch");
      assert.equal(await store.markMatchProcessing(claimedB), true, "B mới hơn A -> chiếm row được");
      await providerB(jobB.material_input);
      await store.persistMatchEnrichment(claimedB, {
        status: "completed",
        source: "auto_enrichment",
        score: 70,
        dealType: "thom_dau_tu",
        isNgoP: 30,
        confidence: "high",
        checkedAt: new Date(T0).toISOString(),
      });
      await store.markTerminal(claimedB, "completed");
      assert.equal(jobB.status, "completed");
    }
    return PUBLISHED;
  };

  const res = await runWorker(store, provider, { maxJobs: 1 });

  assert.equal(store.dispatches, 2, "A và B đều gọi AI");
  assert.equal(res.published, 0, "A mất ownership -> KHÔNG được báo publish");
  assert.equal(res.lostClaims, 1, "A bị CAS chặn ở bước persist");
  const m = store.matches.get("111")!;
  assert.equal(m.enrichment.jobId, "job-B");
  assert.equal(m.enrichment.fingerprint, "hash-B");
  assert.equal(m.enrichment.score, 70, "kết quả của B phải còn nguyên, A không ghi đè");
  assert.equal(m.score, null, "cột manual vẫn không bị đụng");
  assert.deepEqual(store.charges, ["job-A", "job-B"], "mỗi job charge đúng 1");
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

await test("P2-2. manual trước dispatch_started_at của DB -> auto vẫn publish", async () => {
  const store = setup();
  store.nowMs = T0;
  store.dbNowMs = T0 + 5 * MIN;
  store.seedJob();
  store.checks.push({ external_id: "111", created_at: new Date(T0 + MIN).toISOString(), score: 40 });
  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(res.published, 1, "manual trước dispatch thật không được chặn auto");
  assert.equal(res.manualWins, 0);
  assert.equal(store.persistCalls[0]!.patch.score, 82);
  assert.equal(store.jobs[0]!.dispatch_started_at, new Date(store.dbNowMs).toISOString());
});

await test("P2-2. manual sau dispatch_started_at authoritative -> manual thắng, không ghi score auto", async () => {
  const store = setup();
  store.nowMs = T0 + 60 * MIN;
  store.dbNowMs = T0;
  store.seedJob();
  store.seedMatch("111", { score: 77, deal_type: "thom_dau_tu", is_ngop: 91 });
  store.checks.push({ external_id: "111", created_at: new Date(T0 + 5 * MIN).toISOString(), score: 77 });
  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(res.manualWins, 1);
  assert.equal(res.published, 0);
  assert.equal(store.persistCalls[0]!.patch.score, null, "không ghi score auto");
  assert.equal(store.matches.get("111")!.score, 77);
  assert.equal(store.matches.get("111")!.enrichment.score, null);
});

await test("P2-2. retry dùng dispatch_started_at gốc, không dùng đồng hồ local mới", async () => {
  const store = setup();
  const original = new Date(T0 - 10 * MIN).toISOString();
  store.nowMs = T0 + 2 * 60 * MIN;
  store.dbNowMs = T0 + 2 * 60 * MIN;
  store.seedJob({ dispatch_started_at: original, allowance_consumed: true, attempts: 1 });
  store.seedMatch("111", { score: 77, deal_type: "thom_dau_tu", is_ngop: 91 });
  store.checks.push({ external_id: "111", created_at: new Date(T0).toISOString(), score: 77 });
  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(store.jobs[0]!.dispatch_started_at, original, "retry không được ghi đè mốc dispatch");
  assert.equal(res.manualWins, 1);
  assert.equal(res.published, 0);
  assert.equal(store.persistCalls[0]!.patch.score, null);
  assert.equal(store.charges.length, 0, "retry không charge lại");
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
  assert.equal(res.claimed, 0, "backoff >= 30s -> không spin trong cùng tick");
  assert.equal(stale.status, "pending");
  assert.equal(stale.attempts, 1, "requeue không reset attempts");
  assert.equal(stale.dispatch_started_at, new Date(T0 - 12 * MIN).toISOString(), "không xoá cờ charge-once");
  assert.ok(stale.next_attempt_at && Date.parse(stale.next_attempt_at) >= T0 + 30_000);
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

// P1-3: MemStore mô phỏng predicate SQL `processing_started_at < now() - lease`.
// Không chạy Postgres — proof runtime nằm ở test SQL tĩnh của migration 0022.
await test("P1-3. app clock lệch, lease DB chưa hết -> không cướp claim đang sống", async () => {
  const behind = setup();
  behind.dbNowMs = T0;
  behind.nowMs = T0 - 5 * 60 * MIN;
  const live = behind.seedJob({
    id: "job-live",
    status: "processing",
    processing_started_at: new Date(T0 - MIN).toISOString(),
    claim_token: "live-token",
    attempts: 1,
    dispatch_started_at: new Date(T0 - MIN).toISOString(),
    allowance_consumed: true,
  });
  const res = await runWorker(behind, providerFrom(behind, PUBLISHED));
  assert.equal(live.status, "processing");
  assert.equal(live.claim_token, "live-token");
  assert.equal(res.claimed, 0);

  const ahead = setup();
  ahead.dbNowMs = T0;
  ahead.nowMs = T0 + 5 * 60 * MIN;
  const live2 = ahead.seedJob({
    id: "job-live-2",
    status: "processing",
    processing_started_at: new Date(T0 - MIN).toISOString(),
    claim_token: "live-token-2",
    attempts: 1,
    dispatch_started_at: new Date(T0 - MIN).toISOString(),
    allowance_consumed: true,
  });
  await runWorker(ahead, providerFrom(ahead, PUBLISHED));
  assert.equal(live2.status, "processing", "app ahead cũng không được reclaim lease còn hạn theo giờ DB");
  assert.equal(live2.claim_token, "live-token-2");
  assert.equal(live2.dispatch_started_at, new Date(T0 - MIN).toISOString());
});

await test("P1-3. lease hết theo giờ DB vẫn reclaim dù app clock đứng sau", async () => {
  const store = setup();
  store.dbNowMs = T0;
  store.nowMs = T0 - 5 * 60 * MIN;
  const dispatchAt = new Date(T0 - 20 * MIN).toISOString();
  const stale = store.seedJob({
    id: "job-expired",
    status: "processing",
    processing_started_at: new Date(T0 - 11 * MIN).toISOString(),
    claim_token: "old",
    attempts: 1,
    dispatch_started_at: dispatchAt,
    allowance_consumed: true,
  });
  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(stale.status, "pending");
  assert.equal(stale.dispatch_started_at, dispatchAt);
  assert.ok(Date.parse(stale.next_attempt_at!) >= T0 + 30_000);
  assert.equal(res.claimed, 0, "backoff chặn spin cùng tick");

  const deadStore = setup();
  deadStore.dbNowMs = T0;
  deadStore.nowMs = T0 - 5 * 60 * MIN;
  const deadAt = new Date(T0 - 30 * MIN).toISOString();
  const dead = deadStore.seedJob({
    id: "job-dead-skew",
    status: "processing",
    processing_started_at: new Date(T0 - 11 * MIN).toISOString(),
    claim_token: "old",
    attempts: 3,
    dispatch_started_at: deadAt,
    allowance_consumed: true,
  });
  await runWorker(deadStore, providerFrom(deadStore, PUBLISHED));
  assert.equal(dead.status, "failed");
  assert.equal(dead.dispatch_started_at, deadAt, "fail theo attempts cũng không xoá dispatch_started_at");
});

await test("P2-6. job_id null nhưng đã có fingerprint -> job khác không cướp", async () => {
  const store = setup();
  store.matches.get("111")!.enrichment = {
    status: "pending",
    jobId: null,
    fingerprint: "hash-B",
    checkedAt: new Date(T0 - MIN).toISOString(),
    score: 70,
    dealType: "thom_dau_tu",
    isNgoP: 30,
  };
  store.seedJob({ id: "job-A", material_input_hash: "hash-A" });
  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(store.dispatches, 0);
  assert.equal(res.published, 0);
  assert.equal(store.matches.get("111")!.enrichment.fingerprint, "hash-B");
  assert.equal(store.matches.get("111")!.enrichment.score, 70);
  assert.equal(store.matches.get("111")!.enrichment.jobId, null);
});

await test("P2-8. mất claim_token: markTerminal khớp 0 dòng, lostClaims tăng, published không tăng", async () => {
  const store = setup();
  store.seedJob();
  const job = store.jobs[0]!;
  const orig = store.markTerminal.bind(store);
  store.markTerminal = async (j, status, error) => {
    const row = store.jobs.find((x) => x.id === j.id)!;
    row.claim_token = "stolen";
    return orig(j, status, error);
  };
  const res = await runWorker(store, providerFrom(store, PUBLISHED));
  assert.equal(res.published, 0, "CAS miss không được tính publish");
  assert.equal(res.lostClaims >= 1, true);
  assert.equal(job.status, "processing", "không ghi được terminal thì job còn processing để reclaim");
  assert.equal(store.persistCalls.length, 1, "persist row vẫn xảy ra trước khi mất token job");

  store.dbNowMs = T0 + 11 * MIN;
  const reclaimed = await store.reclaimStaleProcessing(10 * MIN, 3);
  assert.equal(reclaimed.requeued, 1, "worker chết vẫn được reclaim");
  assert.equal(job.status, "pending");
  assert.ok(job.dispatch_started_at, "reclaim không xoá dispatch_started_at");
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
