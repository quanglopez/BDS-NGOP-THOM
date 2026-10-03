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

/** Fake DB: `select()` trả `selectRows`; `update()` trả các row khớp filter —
 *  dùng để kiểm tra CAS của từng nhánh (job đang sở hữu / row chưa ai sở hữu /
 *  takeover). */
function matchRow(r: Row, filters: Filter[]): boolean {
  return filters.every(([op, c, v]) => {
    const cell = r[c];
    if (op === "eq") return cell === v;
    if (op === "is") return (cell ?? null) === (v ?? null);
    if (op === "not") return (cell ?? null) !== (v ?? null);
    if (op === "in") return Array.isArray(v) && v.includes(cell);
    if (op === "lt") return cell != null && typeof cell === "string" && typeof v === "string" ? cell < v : Number(cell) < Number(v);
    return true;
  });
}

/** Supabase client ghi lại mọi lệnh; `rpcResults` điều khiển trả về của RPC. */
function recordingDb(rpcResults: Record<string, unknown> = {}) {
  const calls: Recorded[] = [];
  const rowsByTable: Record<string, Row[]> = {};
  let selectRows: Row[] = [];

  function from(table: string) {
    const filters: Filter[] = [];
    const payload: Row | null = null;
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
      is(col: string, val: unknown) { filters.push(["is", col, val]); return api; },
      in(col: string, val: unknown) { filters.push(["in", col, val]); return api; },
      inList(col: string, val: unknown) { filters.push(["in", col, val]); return api; },
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
        // `seed(table)` có dữ liệu -> update chỉ "khớp" row thật theo filter
        // (kiểm tra được CAS từng nhánh). Không seed -> giữ nguyên hành vi cũ:
        // trả về selectRows (test cũ không đổi).
        const seeded = rowsByTable[table];
        const data = rec.op === "update" && seeded ? seeded.filter((r) => matchRow(r, filters)) : selectRows;
        return Promise.resolve({ data, error: null, count: data.length }).then(resolve);
      },
    };
    return api;
  }

  const rpc = (name: string, args: Row) => {
    const rec: Recorded = { op: "rpc", table: name, args, filters: [] };
    calls.push(rec);
    const result = rpcResults[name];
    // Trả đúng kiểu caller khai: boolean, string, null, array, object. Không bọc thêm.
    return Promise.resolve({ data: result === undefined ? [] : result, error: null });
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
  created_at: "2026-10-02T00:00:00Z",
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

await test("beginDispatch truyền p_daily_limit = 200 và trả timestamp RPC, không phải boolean", async () => {
  const h = recordingDb({ begin_auto_enrichment_dispatch_at: "2026-10-01T00:00:00.000Z" });
  const store = createSupabaseEnrichmentStore(h.db);
  assert.equal(await store.beginDispatch(JOB), "2026-10-01T00:00:00.000Z");
  const rpc = h.last("rpc");
  assert.equal(rpc.table, "begin_auto_enrichment_dispatch_at");
  assert.equal(rpc.args!.p_job_id, "job-1");
  assert.equal(rpc.args!.p_claim_token, "token-1");
  assert.equal(rpc.args!.p_daily_limit, 200, "phải khoá đúng policy 200/ngày");
  assert.equal(h.all("update").length, 0, "không UPDATE dispatch_started_at phía client");
});

await test("beginDispatch null khi RPC trả null (cap/stale) — không coi là lỗi", async () => {
  const h = recordingDb({ begin_auto_enrichment_dispatch_at: null });
  const store = createSupabaseEnrichmentStore(h.db);
  assert.equal(await store.beginDispatch(JOB), null);
});

await test("reclaim gọi RPC lease giây, không gửi timestamp app làm đồng hồ", async () => {
  const h = recordingDb({ reclaim_stale_auto_enrichment_jobs: [{ requeued: 1, failed: 2 }] });
  const store = createSupabaseEnrichmentStore(h.db);
  const got = await store.reclaimStaleProcessing(10 * 60 * 1000, 3);
  assert.deepEqual(got, { requeued: 1, failed: 2 });
  const rpc = h.last("rpc")!;
  assert.equal(rpc.table, "reclaim_stale_auto_enrichment_jobs");
  assert.equal(rpc.args!.p_lease_seconds, 600);
  assert.equal(rpc.args!.p_max_attempts, 3);
  assert.ok(Number(rpc.args!.p_backoff_seconds) >= 30, "backoff tối thiểu 30s");
  for (const [k, v] of Object.entries(rpc.args!)) {
    assert.equal(typeof v === "string", false, `${k} không được là timestamp client`);
  }
  assert.equal(h.all("update").length, 0, "không UPDATE lease phía client");
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

await test("FIX 3. markMatchProcessing ghi ĐÚNG 'processing' + job id + fingerprint, không đụng signal", async () => {
  const h = recordingDb();
  h.setRows([{ id: "m1" }]);
  const store = createSupabaseEnrichmentStore(h.db);
  const ok = await store.markMatchProcessing(JOB);
  const u = h.last("update")!;
  assert.equal(u.table, "radar_matches");
  // FIX 3: phải là "processing", KHÔNG phải "pending" (mutation đổi 2 chữ này
  // phải làm test đỏ).
  assert.equal(u.payload!.enrichment_status, "processing");
  assert.notEqual(u.payload!.enrichment_status, "pending");
  assert.equal(u.payload!.enrichment_source, "auto_enrichment");
  assert.equal(u.payload!.enrichment_job_id, "job-1");
  assert.equal(u.payload!.enrichment_fingerprint, "hash-111");
  for (const c of ["enrichment_score", "enrichment_deal_type", "enrichment_is_ngop", "enrichment_checked_at", "enrichment_confidence"]) {
    assert.equal(c in u.payload!, false, `không được ghi ${c} khi chỉ đổi trạng thái`);
  }
  // FIX 2: CAS theo enrichment_job_id — không được lật row của job khác.
  const filters = u.filters.map(([op, col, val]) => `${op}:${col}=${String(val)}`);
  assert.ok(filters.includes("eq:enrichment_job_id=job-1"), `CAS phải khoá theo enrichment_job_id, có: ${filters.join(" | ")}`);
  assert.ok(filters.includes("eq:radar_id=radar-1"));
  assert.ok(filters.includes("eq:external_id=111"));
  assert.equal(ok, true);
});

await test("FIX 2. markMatchProcessing: row của job khác -> false (không overwrite)", async () => {
  const h = recordingDb();
  h.setRows([]);
  const store = createSupabaseEnrichmentStore(h.db);
  const ok = await store.markMatchProcessing(JOB);
  assert.equal(ok, false, "CAS miss phải trả false, không được coi là thành công");
  const second = h.all("update")[1]!;
  assert.ok(
    second.filters.some(([op, col]) => op === "is" && col === "enrichment_job_id"),
    "nhánh claim row chưa ai sở hữu phải lọc enrichment_job_id is null",
  );
  assert.ok(
    second.filters.some(([op, col, val]) => op === "is" && col === "enrichment_fingerprint" && val == null),
    "nhánh job_id null chỉ claim khi chưa có fingerprint",
  );
  assert.ok(
    second.filters.some(([op, col, val]) => op === "is" && col === "enrichment_checked_at" && val == null),
    "nhánh job_id null chỉ claim khi chưa publish (checked_at null)",
  );
  assert.ok(
    second.filters.some(([op, col]) => op === "in" && col === "enrichment_status"),
    "chỉ được claim row chưa có kết quả (not_started/pending)",
  );
  const statusList = second.filters.find(([op, col]) => op === "in" && col === "enrichment_status")?.[2] as string[] | undefined;
  assert.deepEqual(statusList, ["not_started", "pending"], "KHÔNG được claim row processing/completed của job khác");
});

await test("FIX 2. persistMatchEnrichment khoá theo enrichment_job_id", async () => {
  const h = recordingDb();
  h.setRows([{ id: "m1" }]);
  const store = createSupabaseEnrichmentStore(h.db);
  const ok = await store.persistMatchEnrichment(JOB, {
    status: "completed", source: "auto_enrichment", score: 82, dealType: "ngop_ngon", isNgoP: 88, confidence: "high", checkedAt: "2026-10-03T02:00:00Z",
  });
  const filters = h.last("update")!.filters.map(([op, col, val]) => `${op}:${col}=${String(val)}`);
  assert.ok(filters.includes("eq:enrichment_job_id=job-1"), `publish phải CAS theo job, có: ${filters.join(" | ")}`);
  assert.equal(ok, true);
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
  // Write ĐẦU TIÊN là CAS "job đang sở hữu row" — luôn phải khoá đúng 3 cột.
  const u = h.all("update")[0]!;
  assert.equal(u.table, "radar_matches");
  const cols = Object.keys(u.payload!).sort();
  assert.deepEqual(cols, [
    "enrichment_checked_at",
    "enrichment_confidence",
    "enrichment_deal_type",
    "enrichment_fingerprint",
    "enrichment_is_ngop",
    "enrichment_job_created_at",
    "enrichment_job_id",
    "enrichment_score",
    "enrichment_source",
    "enrichment_status",
  ], "payload phải đúng bộ cột enrichment_*, không có cột manual");
  for (const c of cols) assert.ok(c.startsWith("enrichment_"), `${c} phải nằm trong prefix enrichment_`);
  assert.equal(u.payload!.enrichment_checked_at, "2026-10-03T02:00:00Z", "cột timestamp đúng tên enrichment_checked_at");
  assert.equal(u.payload!.enrichment_fingerprint, "hash-111");
  assert.deepEqual(u.filters.map(([op, col]) => `${op}:${col}`).sort(), ["eq:enrichment_job_id", "eq:external_id", "eq:radar_id"]);
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

await test("latestManualCheckAt gọi RPC exact-id, không like hậu tố + limit", async () => {
  const h = recordingDb({ latest_manual_check_at: "2026-10-02T01:00:00Z" });
  const store = createSupabaseEnrichmentStore(h.db);
  assert.equal(await store.latestManualCheckAt("111"), "2026-10-02T01:00:00Z");
  const rpc = h.last("rpc")!;
  assert.equal(rpc.table, "latest_manual_check_at");
  assert.equal(rpc.args!.p_external_id, "111");
  assert.equal(h.all("select").filter((c) => c.table === "checks").length, 0, "không select checks + like");
});

// Model predicate SQL 0022 (substring id = external_id rồi mới limit 1). Không phải proof Postgres.
function modelLatestManualCheckAt(
  rows: { listing_url: string; created_at: string; score: number | null }[],
  externalId: string,
): string | null {
  const hits = rows.filter((r) => r.score != null && r.listing_url.match(/([0-9]+)\.htm($|[?#])/)?.[1] === externalId);
  hits.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return hits[0]?.created_at ?? null;
}

await test("P2-4. >10 check của A vẫn thấy dù B có URL hậu tố mới hơn", async () => {
  const rows: { listing_url: string; created_at: string; score: number | null }[] = [];
  for (let i = 0; i < 12; i++) {
    rows.push({
      listing_url: `https://checkbds.vn/check/nha-111.htm`,
      created_at: `2026-10-01T${String(i).padStart(2, "0")}:00:00Z`,
      score: 10 + i,
    });
  }
  for (let i = 0; i < 15; i++) {
    rows.push({
      listing_url: `https://checkbds.vn/check/nha-${9000 + i}111.htm`,
      created_at: `2026-10-03T${String(i).padStart(2, "0")}:00:00Z`,
      score: 50,
    });
  }
  assert.equal(modelLatestManualCheckAt(rows, "111"), "2026-10-01T11:00:00Z");
  const oldLike = rows
    .filter((r) => r.score != null && r.listing_url.endsWith("111.htm"))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 10);
  assert.equal(oldLike.some((r) => r.listing_url.endsWith("/nha-111.htm")), false, "limit 10 hậu tố che mất check thật");
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

// ---------------------------------------------------------------- P1-1 ownership

const JOB_B: EnrichmentJobRow = { ...JOB, id: "job-B", material_input_hash: "hash-B", created_at: "2026-10-03T00:00:00Z" };
const PATCH = {
  status: "completed" as const,
  source: "auto_enrichment" as const,
  score: 82,
  dealType: "ngop_ngon",
  isNgoP: 88,
  confidence: "high" as const,
  checkedAt: "2026-10-03T02:00:00Z",
};

await test("P1-1. persistMatchEnrichment: job MỚI hơn chủ cũ (fingerprint khác) chiếm được row", async () => {
  const h = recordingDb();
  h.seed("radar_matches", [
    {
      id: "m1", radar_id: "radar-1", external_id: "111",
      enrichment_job_id: "job-A", enrichment_fingerprint: "hash-A",
      enrichment_job_created_at: "2026-10-01T00:00:00Z", enrichment_status: "completed",
    },
  ]);
  const store = createSupabaseEnrichmentStore(h.db);
  assert.equal(await store.persistMatchEnrichment(JOB_B, PATCH), true, "job tạo sau (material đổi) phải publish được");

  const ups = h.all("update");
  assert.equal(ups.length >= 2, true, "phải thử CAS chủ sở hữu trước, takeover sau");
  const takeover = ups.at(-1)!;
  assert.equal(takeover.payload!.enrichment_fingerprint, "hash-B");
  assert.equal(takeover.payload!.enrichment_job_id, "job-B");
  assert.equal(takeover.payload!.enrichment_job_created_at, "2026-10-03T00:00:00Z");
  const guards = takeover.filters.map(([op, col]) => `${op}:${col}`);
  assert.ok(guards.includes("lt:enrichment_job_created_at"), `takeover phải guard theo created_at, có: ${guards.join(" | ")}`);
  assert.ok(guards.includes("eq:radar_id") && guards.includes("eq:external_id"));
  // Chỉ ghi cột enrichment_* — cột manual không xuất hiện.
  for (const c of Object.keys(takeover.payload!)) assert.ok(c.startsWith("enrichment_"), `${c} phải thuộc prefix enrichment_`);
});

await test("P1-1. persistMatchEnrichment: job CŨ hơn chủ hiện tại -> false, không ghi đè", async () => {
  const h = recordingDb();
  h.seed("radar_matches", [
    {
      id: "m1", radar_id: "radar-1", external_id: "111",
      enrichment_job_id: "job-B", enrichment_fingerprint: "hash-B",
      enrichment_job_created_at: "2026-10-03T00:00:00Z", enrichment_status: "completed",
    },
  ]);
  const store = createSupabaseEnrichmentStore(h.db);
  // job-A (created 2026-10-02) cố publish đè lên row do job-B (created 2026-10-03) sở hữu.
  assert.equal(await store.persistMatchEnrichment(JOB, PATCH), false, "job cũ không được ghi đè job mới");
  const takeover = h.all("update").at(-1)!;
  const guards = takeover.filters.map(([op, col, val]) => `${op}:${col}=${String(val)}`);
  assert.ok(guards.includes("eq:radar_id=radar-1") && guards.includes("eq:external_id=111"), "takeover vẫn khoá radar+listing");
  assert.ok(guards.includes("lt:enrichment_job_created_at=2026-10-02T00:00:00Z"), `takeover phải guard theo created_at CỦA JOB NÀY, có: ${guards.join(" | ")}`);
});

await test("P1-1. markMatchProcessing: takeover chỉ khi chủ cũ CỨ hơn job này", async () => {
  const olderOwner = recordingDb();
  olderOwner.seed("radar_matches", [
    { id: "m1", radar_id: "radar-1", external_id: "111", enrichment_job_id: "job-A", enrichment_fingerprint: "hash-A", enrichment_job_created_at: "2026-10-01T00:00:00Z" },
  ]);
  assert.equal(await createSupabaseEnrichmentStore(olderOwner.db).markMatchProcessing(JOB_B), true, "job mới hơn phải chiếm được row processing");

  const newerOwner = recordingDb();
  newerOwner.seed("radar_matches", [
    { id: "m1", radar_id: "radar-1", external_id: "111", enrichment_job_id: "job-B", enrichment_fingerprint: "hash-B", enrichment_job_created_at: "2026-10-03T00:00:00Z" },
  ]);
  assert.equal(await createSupabaseEnrichmentStore(newerOwner.db).markMatchProcessing(JOB), false, "job cũ hơn không được chiếm row của job mới");

  // Row chưa từng ghi enrichment_job_created_at (code trước migration 0021):
  // không chứng minh được chủ cũ CỨ hơn -> KHÔNG takeover (an toàn, không ghi đè
  // mờ). 0021 đi kèm code này nên mọi row ghi sau deploy đều có tuổi.
  const legacyOwner = recordingDb();
  legacyOwner.seed("radar_matches", [
    { id: "m1", radar_id: "radar-1", external_id: "111", enrichment_job_id: "job-legacy", enrichment_fingerprint: "hash-A", enrichment_job_created_at: null },
  ]);
  assert.equal(await createSupabaseEnrichmentStore(legacyOwner.db).markMatchProcessing(JOB_B), false, "không có tuổi của chủ cũ -> không đè");
});

await test("P2-6. job_id null nhưng còn fingerprint của B -> A không cướp", async () => {
  const h = recordingDb();
  h.seed("radar_matches", [
    {
      id: "m1", radar_id: "radar-1", external_id: "111",
      enrichment_job_id: null, enrichment_fingerprint: "hash-B",
      enrichment_checked_at: "2026-10-03T00:00:00Z", enrichment_status: "pending",
      enrichment_job_created_at: "2026-10-03T00:00:00Z",
    },
  ]);
  assert.equal(await createSupabaseEnrichmentStore(h.db).markMatchProcessing(JOB), false, "A không được chiếm row đã publish của B");
  const fresh = h.all("update")[1]!;
  assert.ok(fresh.filters.some(([op, col]) => op === "is" && col === "enrichment_fingerprint"));
});

await test("P2-8. markTerminal false khi claim_token không khớp, true khi khớp", async () => {
  const miss = recordingDb();
  miss.seed("auto_enrichment_jobs", [{ id: "job-1", claim_token: "stolen", status: "processing" }]);
  assert.equal(await createSupabaseEnrichmentStore(miss.db).markTerminal(JOB, "completed"), false);
  const filters = miss.last("update")!.filters.map(([op, col]) => `${op}:${col}`);
  assert.ok(filters.includes("eq:claim_token") && filters.includes("eq:id") && filters.includes("eq:status"));

  const hit = recordingDb();
  hit.seed("auto_enrichment_jobs", [{ id: "job-1", claim_token: "token-1", status: "processing" }]);
  assert.equal(await createSupabaseEnrichmentStore(hit.db).markTerminal(JOB, "completed"), true);
});

await test("P1-1. takeover vẫn ghi 'processing' + đúng fingerprint/job của job mới", async () => {
  const h = recordingDb();
  h.seed("radar_matches", [
    { id: "m1", radar_id: "radar-1", external_id: "111", enrichment_job_id: "job-A", enrichment_fingerprint: "hash-A", enrichment_job_created_at: "2026-10-01T00:00:00Z" },
  ]);
  await createSupabaseEnrichmentStore(h.db).markMatchProcessing(JOB_B);
  const takeover = h.all("update").at(-1)!;
  assert.equal(takeover.payload!.enrichment_status, "processing");
  assert.equal(takeover.payload!.enrichment_fingerprint, "hash-B");
  assert.equal(takeover.payload!.enrichment_job_id, "job-B");
  for (const c of ["enrichment_score", "enrichment_deal_type", "enrichment_is_ngop", "enrichment_checked_at", "enrichment_confidence"]) {
    assert.equal(c in takeover.payload!, false, `markProcessing không được ghi ${c}`);
  }
});

console.log(`\nradar-enrichment-store: ${failures} fail`);
process.exitCode = failures ? 1 : 0;