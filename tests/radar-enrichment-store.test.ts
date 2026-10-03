// Self-check: Supabase adapter của enrichment worker (payload + CAS filters).
// MemStore ở radar-enrichment-worker.test.ts mô phỏng semantics; file này khóa
// đúng NHỮNG GÌ store gửi lên DB: payload, điều kiện CAS, tham số RPC.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSupabaseEnrichmentStore } from "@/lib/radar/enrichment-store";
import type { EnrichmentJobRow } from "@/lib/radar/enrichment-worker";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

interface Recorded {
  op: "select" | "update" | "insert" | "rpc";
  table?: string;
  payload?: Row;
  filters: Filter[];
  orderCol?: string;
  orderAsc?: boolean;
  limit?: number;
  args?: Row;
}
type Filter = [op: string, col: string, val: unknown];

/** Supabase client ghi lại mọi lệnh; `rpcResults` điều khiển trả về của RPC. */
function recordingDb(rpcResults: Record<string, unknown> = {}) {
  const calls: Recorded[] = [];
  const rowsByTable: Record<string, Row[]> = {};
  let selectRows: Row[] = [];

  function from(table: string) {
    const filters: Filter[] = [];
    let payload: Row | null = null;
    let orderCol: string | undefined;
    let orderAsc = true;
    let limit: number | undefined;
    const rec: Recorded = { op: "select", table, filters };

    const api = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        // `.select()` cuối chuỗi update/insert CHỈ định payload trả về, không đổi op.
        if (rec.op === "select") rec.op = "select";
        return api;
      },
      update(p: Row) {
        rec.op = "update";
        rec.payload = p;
        return api;
      },
      insert(p: Row[]) {
        rec.op = "insert";
        rec.payload = p as unknown as Row;
        return api;
      },
      eq(col: string, val: unknown) { filters.push(["eq", col, val]); return api; },
      gte(col: string, val: unknown) { filters.push(["gte", col, val]); return api; },
      lt(col: string, val: unknown) { filters.push(["lt", col, val]); return api; },
      gte2() { return api; },
      not(col: string, _o: string, val: unknown) { filters.push(["not", col, val]); return api; },
      in(col: string, val: unknown) { filters.push(["in", col, val]); return api; },
      like(col: string, val: unknown) { filters.push(["like", col, val]); return api; },
      order(col: string, opts?: { ascending?: boolean }) { orderCol = col; orderAsc = opts?.ascending ?? true; return api; },
      limit(n?: number) { limit = n; return api; },
      maybeSingle() {
        rec.op = "select";
        rec.filters = filters;
        rec.orderCol = orderCol;
        rec.orderAsc = orderAsc;
        rec.limit = limit;
        calls.push(rec);
        return Promise.resolve({ data: selectRows[0] ?? null, error: null });
      },
      then(resolve: (v: unknown) => unknown) {
        rec.filters = filters;
        rec.orderCol = orderCol;
        rec.orderAsc = orderAsc;
        rec.limit = limit;
        calls.push(rec);
        return Promise.resolve({ data: selectRows, error: null, count: selectRows.length }).then(resolve);
      },
    };
    return api;
  }

  const rpc = (name: string, args: Row) => {
    const rec: Recorded = { op: "rpc", table: name, args, filters: [] };
    calls.push(rec);
    const result = rpcResults[name];
    // RPC trả scalar boolean (begin_dispatch) hoặc setof rows (claim).
    if (typeof result === "boolean") return Promise.resolve({ data: result, error: null });
    const data = Array.isArray(result) ? result : result === undefined ? [] : [result];
    return Promise.resolve({ data, error: null });
  };

  return {
    db: { from, rpc } as unknown as SupabaseClient,
    calls,
    setRows(rows: Row[]) { selectRows = rows; },
    seed(table: string, rows: Row[]) { rowsByTable[table] = rows; },
    last(op: Recorded["op"], table?: string) {
      for (let i = calls.length - 1; i >= 0; i--) {
        if (calls[i]!.op === op && (!table || calls[i]!.table === table)) return calls[i]!;
      }
      return null;
    },
    all(op: Recorded["op"]) { return calls.filter((c) => c.op === op); },
  };
}

const JOB: EnrichmentJobRow = {
  id: "job-1",
  user_id: "user-1",
  radar_id: "radar-1",
  external_id: "111",
  material_input: { title: "Tin", price_vnd: 5e9, size_m2: 50 },
  material_input_hash: "hash-111",
  attempts: 1,
  dispatch_started_at: "2026-10-03T00:00:00Z",
  claim_token: "token-1",
};

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  ok  ${name}`); } catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
}

await test("claimPending gọi RPC với limit, không dùng SELECT/UPDATE rời", async () => {
  const h = recordingDb({ claim_auto_enrichment_jobs: [JOB] });
  const store = createSupabaseEnrichmentStore(h.db);
  const got = await store.claimPending(5);
  assert.equal(got.length, 1);
  assert.equal(got[0]!.id, "job-1");
  const rpc = h.last("rpc");
  assert.ok(rpc, "phải gọi RPC");
  assert.equal(rpc.table, "claim_auto_enrichment_jobs");
  assert.equal(rpc.args!.p_limit, 5);
  assert.equal(h.all("update").length, 0, "không được UPDATE thủ công sau SELECT");
});

await test("beginDispatch truyền p_daily_limit = 200 (cap ngày chốt ở DB)", async () => {
  const h = recordingDb({ begin_auto_enrichment_dispatch: true });
  const store = createSupabaseEnrichmentStore(h.db);
  assert.equal(await store.beginDispatch(JOB), true);
  const rpc = h.last("rpc");
  assert.equal(rpc.table, "begin_auto_enrichment_dispatch");
  assert.equal(rpc.args!.p_job_id, "job-1");
  assert.equal(rpc.args!.p_claim_token, "token-1");
  assert.equal(rpc.args!.p_daily_limit, 200, "phải khoá đúng policy 200/ngày");
});

await test("beginDispatch false khi RPC trả false (cap/stale) — không coi là lỗi", async () => {
  const h = recordingDb({ begin_auto_enrichment_dispatch: false });
  const store = createSupabaseEnrichmentStore(h.db);
  assert.equal(await store.beginDispatch(JOB), false);
});

await test("reclaim: xoá lease (claim_token + processing_started_at), lọc đúng 2 nhánh", async () => {
  const h = recordingDb();
  const store = createSupabaseEnrichmentStore(h.db);
  await store.reclaimStaleProcessing("2026-10-03T00:00:00Z", 3);

  const ups = h.all("update");
  assert.equal(ups.length, 2, "2 nhánh: còn lượt -> pending, hết lượt -> failed");
  for (const u of ups) {
    assert.equal(u.table, "auto_enrichment_jobs");
    assert.equal(u.payload!.claim_token, null, "phải xoá claim token");
    assert.equal(u.payload!.processing_started_at, null, "phải xoá processing_started_at (lease hết hiệu lực)");
    assert.equal(u.payload!.error_kind, "lease_expired");
  }
  assert.equal(ups[0]!.payload!.status, "pending");
  assert.equal(ups[0]!.payload!.next_attempt_at != null, true, "requeue phải có lịch chạy lại");
  assert.equal(ups[1]!.payload!.status, "failed");
  // CAS: chỉ job processing quá lease + đúng nhánh attempts.
  for (const u of ups) {
    const kinds = u.filters.map(([op]) => op);
    assert.ok(kinds.includes("lt") && kinds.includes("eq"), "phải có điều kiện lọc (status + lease)");
  }
  const attemptsFilters = ups.map((u) => u.filters.filter(([op]) => op === "lt" || op === "gte").map(([op, col]) => `${op}:${col}`).join(","));
  assert.notEqual(attemptsFilters[0], attemptsFilters[1], "2 nhánh phải lọc attempts khác nhau (< max vs >= max)");
});

await test("releaseToPending: CAS theo id + claim_token + status=processing", async () => {
  const h = recordingDb();
  const store = createSupabaseEnrichmentStore(h.db);
  await store.releaseToPending(JOB, { nextAttemptAt: "2026-10-03T01:00:00Z", updatedAt: "2026-10-03T00:30:00Z", errorKind: "retryable_error", lastError: "retryable_error" });
  const u = h.last("update")!;
  assert.equal(u.payload!.status, "pending");
  assert.equal(u.payload!.next_attempt_at, "2026-10-03T01:00:00Z");
  assert.equal(u.payload!.claim_token, null);
  assert.equal(u.payload!.processing_started_at, null);
  const f = u.filters.map(([op, col, val]) => `${op}:${col}=${String(val)}`).sort();
  assert.deepEqual(f, [
    "eq:claim_token=token-1",
    "eq:id=job-1",
    "eq:status=processing",
  ], "phải CAS đủ id + claim_token + status (không được UPDATE mù)");
});

await test("markTerminal: CAS id + claim_token + status, ghi error_kind/last_error", async () => {
  const h = recordingDb();
  const store = createSupabaseEnrichmentStore(h.db);
  await store.markTerminal(JOB, "completed");
  const ok = h.last("update")!;
  assert.equal(ok.payload!.status, "completed");
  assert.equal(ok.payload!.claim_token, null);
  assert.equal(ok.payload!.error_kind, null);
  assert.deepEqual(ok.filters.map(([op, col]) => `${op}:${col}`).sort(), ["eq:claim_token", "eq:id", "eq:status"]);

  await store.markTerminal(JOB, "failed", { errorKind: "retryable_error", lastError: "retryable_error" });
  const bad = h.last("update")!;
  assert.equal(bad.payload!.status, "failed");
  assert.equal(bad.payload!.error_kind, "retryable_error");
});

await test("FIX 2: markMatchProcessing ghi processing, KHÔNG đụng score/deal_type/is_ngop", async () => {
  const h = recordingDb();
  const store = createSupabaseEnrichmentStore(h.db);
  await store.markMatchProcessing(JOB);
  const u = h.last("update")!;
  assert.equal(u.table, "radar_matches");
  assert.equal(u.payload!.enrichment_status, "processing");
  assert.equal(u.payload!.enrichment_source, "auto_enrichment");
  assert.equal(u.payload!.enrichment_job_id, "job-1");
  assert.equal(u.payload!.enrichment_fingerprint, "hash-111");
  for (const c of ["enrichment_score", "enrichment_deal_type", "enrichment_is_ngop", "enrichment_checked_at", "enrichment_confidence"]) {
    assert.equal(c in u.payload!, false, `không được ghi ${c} khi chỉ đổi trạng thái`);
  }
  assert.deepEqual(u.filters.map(([op, col]) => `${op}:${col}`).sort(), ["eq:external_id", "eq:radar_id"]);
});

await test("MANDATORY 31. persistMatchEnrichment CHỈ ghi cột enrichment_*, đúng radar_id+external_id", async () => {
  const h = recordingDb();
  const store = createSupabaseEnrichmentStore(h.db);
  await store.persistMatchEnrichment(JOB, {
    status: "completed",
    source: "auto_enrichment",
    score: 82,
    dealType: "ngop_ngon",
    isNgoP: 88,
    confidence: "high",
    checkedAt: "2026-10-03T02:00:00Z",
  });
  const u = h.last("update")!;
  assert.equal(u.table, "radar_matches");
  const cols = Object.keys(u.payload!).sort();
  assert.deepEqual(cols, [
    "enrichment_checked_at",
    "enrichment_confidence",
    "enrichment_deal_type",
    "enrichment_fingerprint",
    "enrichment_is_ngop",
    "enrichment_job_id",
    "enrichment_score",
    "enrichment_source",
    "enrichment_status",
  ], "payload phải đúng bộ cột enrichment_*, không có cột manual");
  for (const c of cols) assert.ok(c.startsWith("enrichment_"), `${c} phải nằm trong prefix enrichment_`);
  assert.equal(u.payload!.enrichment_checked_at, "2026-10-03T02:00:00Z", "cột timestamp đúng tên enrichment_checked_at");
  assert.equal(u.payload!.enrichment_fingerprint, "hash-111");
  assert.deepEqual(u.filters.map(([op, col]) => `${op}:${col}`).sort(), ["eq:external_id", "eq:radar_id"]);
});

await test("persistMatchEnrichment giữ nguyên null (score=0 không bị đổi, null không thành 0)", async () => {
  const h = recordingDb();
  const store = createSupabaseEnrichmentStore(h.db);
  await store.persistMatchEnrichment(JOB, {
    status: "low_confidence",
    source: "auto_enrichment",
    score: null,
    dealType: null,
    isNgoP: null,
    confidence: "low",
    checkedAt: "2026-10-03T02:00:00Z",
  });
  let p = h.last("update")!.payload!;
  assert.equal(p.enrichment_score, null);
  assert.equal(p.enrichment_deal_type, null);
  assert.equal(p.enrichment_is_ngop, null);
  assert.notEqual(p.enrichment_score, 0);

  await store.persistMatchEnrichment(JOB, {
    status: "completed",
    source: "auto_enrichment",
    score: 0,
    dealType: "binh_thuong",
    isNgoP: 0,
    confidence: "medium",
    checkedAt: "2026-10-03T02:00:00Z",
  });
  p = h.last("update")!.payload!;
  assert.equal(p.enrichment_score, 0);
  assert.notEqual(p.enrichment_score, null);
  assert.equal(p.enrichment_is_ngop, 0);
});

await test("latestManualCheckAt: lọc theo external_id chính xác + chỉ Check đã chấm + sort mới nhất", async () => {
  const h = recordingDb();
  h.setRows([
    { listing_url: "https://checkbds.vn/check/nha-123456.htm", created_at: "2026-10-03T01:00:00Z" },
    { listing_url: "https://checkbds.vn/check/nha-111.htm", created_at: "2026-10-02T01:00:00Z" },
  ]);
  const store = createSupabaseEnrichmentStore(h.db);
  const at = await store.latestManualCheckAt("111");
  assert.equal(at, "2026-10-02T01:00:00Z", "123456 là id KHÁC, không được khớp 111");
  const q = h.last("select")!;
  assert.equal(q.table, "checks");
  assert.ok(q.filters.some(([op, col]) => op === "not" && col === "score"), "chỉ Check đã chấm");
  assert.ok(q.filters.some(([op, col]) => op === "like" && col === "listing_url"), "lọc theo URL chứa external_id");
  assert.ok(q.filters.some(([op]) => op === "gte" || op === "not"), "không đọc original_text");
  assert.equal(q.orderCol, "created_at");
  assert.equal(q.orderAsc, false, "mới nhất trước");
});

await test("isPlanPro đọc plan + plan_expires_at, không đoán plan khác", async () => {
  const h = recordingDb();
  h.setRows([{ plan: "pro", plan_expires_at: "2099-01-01T00:00:00Z" }]);
  assert.equal(await createSupabaseEnrichmentStore(h.db).isPlanPro("user-1"), true);

  const expired = recordingDb();
  expired.setRows([{ plan: "pro", plan_expires_at: "2020-01-01T00:00:00Z" }]);
  assert.equal(await createSupabaseEnrichmentStore(expired.db).isPlanPro("user-1"), false, "hết hạn = free");

  const team = recordingDb();
  team.setRows([{ plan: "team", plan_expires_at: "2099-01-01T00:00:00Z" }]);
  assert.equal(await createSupabaseEnrichmentStore(team.db).isPlanPro("user-1"), false, "PRO-only");
});

console.log(`\nradar-enrichment-store: ${failures} fail`);
process.exitCode = failures ? 1 : 0;