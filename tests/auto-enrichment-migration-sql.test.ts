// Self-check: migration 0020 — PRIVILEGES, RLS, RPC bodies, index, CAS.
// Parse theo vùng (function body / statement) rồi assert predicate thuộc đúng
// vùng đó. Không grep token rời rạc, không assert literal "200".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SQL = readFileSync(new URL("../supabase/migrations/0020_auto_enrichment_v1.sql", import.meta.url), "utf8");
const SQL_0021 = readFileSync(new URL("../supabase/migrations/0021_radar_match_enrichment_ownership.sql", import.meta.url), "utf8");
const SQL_0022 = readFileSync(new URL("../supabase/migrations/0022_enrichment_lease_and_dispatch_clock.sql", import.meta.url), "utf8");

/** Cắt phần thân của `create or replace function ... $$ ... $$;` theo tên. */
function functionBody(name: string): string {
  const start = SQL.indexOf(`function public.${name}(`);
  assert.ok(start >= 0, `thiếu function public.${name}`);
  const open = SQL.indexOf("$$", start);
  const close = SQL.indexOf("$$", open + 2);
  assert.ok(open >= 0 && close > open, `function ${name} thiếu delim $$`);
  return SQL.slice(open + 2, close);
}

/** Cắt 1 statement (revoke/grant/create index/alter...) theo tiền tố + câu kết. */
function statements(prefix: string): string[] {
  const out: string[] = [];
  let idx = 0;
  for (;;) {
    const at = SQL.indexOf(prefix, idx);
    if (at < 0) break;
    const end = SQL.indexOf(";", at);
    assert.ok(end > at, `statement '${prefix}' thiếu dấu ;`);
    out.push(SQL.slice(at, end + 1));
    idx = end + 1;
  }
  return out;
}

/** Chuẩn hoá whitespace để so khớp predicate không vỡ vì xuống dòng. */
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

let failures = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ok  ${name}`); } catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
}

// ================================================================ A. RLS

/** Đoạn `create [or replace] function ... $$` (phần định nghĩa + security). */
function functionSource(name: string): string {
  const start = SQL.indexOf(`function public.${name}(`);
  assert.ok(start >= 0, `thiếu function public.${name}`);
  const defAt = SQL.lastIndexOf("create ", start);
  const end = SQL.indexOf(";", SQL.indexOf("$$", SQL.indexOf("$$", start) + 2) + 2);
  assert.ok(defAt >= 0 && end > start, `function ${name} thiếu vị trí định nghĩa`);
  return flat(SQL.slice(defAt, end + 1));
}

test("A1. RLS bật trên jobs VÀ allowance", () => {
  for (const t of ["auto_enrichment_jobs", "auto_enrichment_allowance"]) {
    assert.ok(
      new RegExp(`alter table public\\.${t} enable row level security`).test(SQL),
      `thiếu enable row level security cho ${t}`,
    );
  }
  // Không được tắt RLS.
  assert.equal(/alter table public\.auto_enrichment_(jobs|allowance) disable row level security/i.test(SQL), false);
});

test("A2. policy SELECT chỉ own user (auth.uid() = user_id), to authenticated", () => {
  const m = SQL.match(/create policy\s+"auto_enrichment_jobs_select_own"[^;]*;/);
  assert.ok(m, "thiếu policy auto_enrichment_jobs_select_own");
  const p = flat(m![0]);
  assert.match(p, /for select to authenticated/);
  assert.match(p, /using \(auth\.uid\(\) = user_id\)/);
  // KHÔNG có policy ghi cho client.
  const writePolicies = statements("create policy").filter((s) => /for (insert|update|delete)/i.test(s));
  assert.deepEqual(writePolicies, [], `không được có policy ghi cho client: ${writePolicies.join(" | ")}`);
});

// ================================================================ B. GRANTS

test("B1. anon: revoke ALL trên jobs và allowance", () => {
  assert.ok(statements("revoke all on public.auto_enrichment_jobs from anon").length > 0, "thiếu revoke all ... from anon");
  assert.ok(statements("revoke all on public.auto_enrichment_allowance from anon").length > 0, "thiếu revoke all allowance ... from anon");
});

test("B2. authenticated: revoke ALL (bỏ cả TRUNCATE/REFERENCES/TRIGGER) rồi chỉ grant SELECT", () => {
  const allAuth = statements("revoke all on public.auto_enrichment_jobs from authenticated");
  assert.equal(allAuth.length, 1, "phải có đúng 1 revoke all ... from authenticated");
  const sel = statements("grant select on public.auto_enrichment_jobs to authenticated");
  assert.equal(sel.length, 1, "phải grant select cho authenticated");
  // Không được cấp quyền khác cho authenticated (insert/update/delete/truncate/
  // references/trigger/all).
  const badGrants = statements("grant").filter(
    (g) =>
      /on public\.auto_enrichment_(jobs|allowance) to authenticated/i.test(g) &&
      !/grant select on public\.auto_enrichment_jobs to authenticated/i.test(g),
  );
  assert.deepEqual(badGrants, [], `authenticated không được có quyền này: ${badGrants.join(" | ")}`);
  // Revoke rời rạc (chỉ insert/update/delete) là bug của vòng trước -> cấm.
  assert.equal(
    /revoke (insert|update|delete),?\s*(insert|update|delete|,?\s*)*on public\.auto_enrichment_jobs from authenticated/i.test(SQL),
    false,
    "revoke rời rạc không bỏ được TRUNCATE/REFERENCES/TRIGGER",
  );
});

test("B3. service_role giữ đường server-side (grant all) — không vô tình chặn", () => {
  assert.ok(statements("grant all on public.auto_enrichment_jobs to service_role").length > 0, "thiếu grant all jobs cho service_role");
  assert.ok(statements("grant all on public.auto_enrichment_allowance to service_role").length > 0, "thiếu grant all allowance cho service_role");
  assert.equal(/revoke all on public\.auto_enrichment_\w+ from service_role/i.test(SQL), false, "không được revoke service_role");
});

test("B4. RPC: revoke all từ public/anon/authenticated + grant execute service_role, KHÔNG lộ mutator cho client", () => {
  for (const fn of ["claim_auto_enrichment_jobs", "begin_auto_enrichment_dispatch"]) {
    const revokes = statements(`revoke all on function public.${fn}`).filter((r) => /from public, anon, authenticated/i.test(r));
    assert.equal(revokes.length, 1, `${fn}: thiếu revoke all ... from public, anon, authenticated`);
    const grants = statements(`grant execute on function public.${fn}`).filter((g) => /to service_role/i.test(g));
    assert.equal(grants.length, 1, `${fn}: thiếu grant execute ... to service_role`);
    const anonGrants = statements("grant execute").filter((g) => new RegExp(`${fn}\\(`).test(g) && /to (anon|authenticated|public)/i.test(g));
    assert.deepEqual(anonGrants, [], `${fn}: không được grant execute cho client`);
  }
});

// ================================================================ C. charge-once

test("C1. begin_dispatch: charge chỉ khi dispatch_started_at IS NULL (retry không charge lại)", () => {
  const body = flat(functionBody("begin_auto_enrichment_dispatch"));
  assert.match(body, /select user_id, dispatch_started_at is null into v_user, v_needs_charge/i, "phải đọc cờ dispatch_started_at is null");
  assert.match(body, /if v_needs_charge then/i, "phải có nhánh if v_needs_charge");
  // Charge (upsert allowance) + set cờ CHỈ nằm trong nhánh if v_needs_charge.
  const chargeAt = body.indexOf("insert into public.auto_enrichment_allowance");
  const branchAt = body.indexOf("if v_needs_charge then");
  const endBranchAt = body.indexOf("update public.auto_enrichment_jobs set dispatch_started_at");
  assert.ok(branchAt >= 0 && chargeAt > branchAt, "charge phải nằm SAU if v_needs_charge");
  assert.ok(endBranchAt > chargeAt, "set dispatch_started_at phải nằm sau charge, trong cùng nhánh");
  // attempts tăng ở NGOÀI nhánh (mọi attempt đều đếm, nhưng chỉ 1 lần charge).
  const attemptsAt = body.indexOf("set attempts = attempts + 1");
  assert.ok(attemptsAt > endBranchAt, "tăng attempts phải nằm ngoài nhánh charge (retry đếm attempt, không charge)");
});

test("C2. begin_dispatch: claim an toàn (id + claim_token + status='processing' + FOR UPDATE)", () => {
  const body = flat(functionBody("begin_auto_enrichment_dispatch"));
  // Khoá dòng: đủ CẢ 3 điều kiện, không được bỏ claim_token (2 worker cùng id).
  const lock = body.slice(body.indexOf("from public.auto_enrichment_jobs"), body.indexOf("for update"));
  assert.match(lock, /where id = p_job_id/i, "thiếu điều kiện id");
  assert.match(lock, /and claim_token = p_claim_token/i, "thiếu điều kiện claim_token (CAS)");
  assert.match(lock, /and status = 'processing'/i, "thiếu điều kiện status='processing'");
  assert.match(body, /for update/i, "phải khoá dòng trước khi charge (tránh 2 worker charge cùng 1 job)");
  assert.match(body, /if v_user is null then return false/i, "mất claim -> false, không charge");
  // Mọi câu UPDATE tiếp theo cũng phải khoá theo claim_token.
  const updates = [...body.matchAll(/update public\.auto_enrichment_jobs([\s\S]*?)where([^;]*?);/g)].map((m) => flat(m[2]!));
  assert.ok(updates.length >= 2, `phải có >= 2 lệnh update trong begin_dispatch, thấy ${updates.length}`);
  for (const w of updates) {
    assert.match(w, /id = p_job_id/i);
    assert.match(w, /claim_token = p_claim_token/i, "update phải khoá theo claim_token");
  }
});

// ================================================================ D. daily cap

test("D1. daily cap: predicate `consumed < p_daily_limit` nằm trong upsert allowance", () => {
  const body = flat(functionBody("begin_auto_enrichment_dispatch"));
  const upsert = body.slice(body.indexOf("insert into public.auto_enrichment_allowance"));
  assert.match(upsert, /on conflict \(user_id, day\) do update/i);
  assert.match(upsert, /where public\.auto_enrichment_allowance\.consumed < p_daily_limit/i, "cap phải là predicate trong SQL");
  assert.match(body, /returning consumed into v_consumed/i);
  assert.match(body, /if v_consumed is null then return false/i, "hết cap -> false (không dispatch)");
  assert.match(body, /coalesce\(p_daily_limit, 0\) < 1 then return false/i, "limit <= 0 -> chặn");
});

test("D2. daily cap: ngày tính theo giờ Việt Nam, allowance theo (user, ngày)", () => {
  const body = flat(functionBody("begin_auto_enrichment_dispatch"));
  assert.match(body, /\(now\(\) at time zone 'Asia\/Ho_Chi_Minh'\)::date/i);
  assert.ok(
    /create table if not exists public\.auto_enrichment_allowance[\s\S]*?primary key \(user_id, day\)/i.test(SQL),
    "allowance phải có PK (user_id, day)",
  );
});

// ================================================================ E. claim

test("E1. claim: FOR UPDATE SKIP LOCKED + status/next_attempt_at predicates", () => {
  const body = flat(functionBody("claim_auto_enrichment_jobs"));
  assert.match(body, /for update skip locked/i, "thiếu FOR UPDATE SKIP LOCKED (2 worker sẽ claim trùng job)");
  assert.match(body, /where status = 'pending'/i, "chỉ claim job pending");
  assert.match(body, /and \(next_attempt_at is null or next_attempt_at <= now\(\)\)/i, "phải tôn trọng lịch retry");
  assert.match(body, /order by created_at/i, "claim theo FIFO");
  assert.match(body, /set status = 'processing'/i);
  assert.match(body, /claim_token = gen_random_uuid\(\)/i, "phải sinh claim token mỗi lần claim");
  assert.match(body, /processing_started_at = now\(\)/i, "phải set lease để reclaim được");
  // security definer + search_path nằm NGOÀI thân $$ -> assert trên định nghĩa.
  const def = functionSource("claim_auto_enrichment_jobs");
  assert.match(def, /security definer/i);
  assert.match(def, /set search_path = public, pg_temp/i, "phải khoá search_path");
});

test("E2. claim: limit có trần (không nhận p_limit âm/lớn tuỳ ý)", () => {
  const body = flat(functionBody("claim_auto_enrichment_jobs"));
  assert.match(body, /limit greatest\(1, least\(coalesce\(p_limit, 10\), 100\)\)/i);
});

// ================================================================ F. unique active job

test("F1. partial unique index đúng key + predicate", () => {
  const idx = statements("create unique index if not exists auto_enrichment_jobs_unique_active")[0];
  assert.ok(idx, "thiếu unique index active");
  assert.match(idx, /unique index/i);
  assert.match(idx, /on public\.auto_enrichment_jobs\s*\(radar_id, external_id, material_input_hash\)/i, "key phải gồm 3 cột");
  assert.match(idx, /where status in \('pending','processing'\)/i, "chỉ unique với job active");
});

// ================================================================ G. CAS + columns

test("G1. các cột vòng đời job có trong create table/alter", () => {
  for (const col of [
    "attempts", "dispatch_started_at", "allowance_consumed", "processing_started_at",
    "next_attempt_at", "claim_token", "error_kind", "last_error",
  ]) {
    assert.ok(new RegExp(`\\b${col}\\b`).test(SQL), `thiếu cột ${col}`);
  }
  assert.match(SQL, /material_input_hash text not null/i, "fingerprint bắt buộc");
  assert.match(SQL, /material_input jsonb not null/i);
});

test("G2. cột enrichment_* trên radar_matches đủ + có check constraint", () => {
  for (const col of [
    "enrichment_status", "enrichment_source", "enrichment_score", "enrichment_deal_type",
    "enrichment_is_ngop", "enrichment_confidence", "enrichment_checked_at", "enrichment_job_id",
    "enrichment_fingerprint",
  ]) {
    assert.ok(new RegExp(`add column if not exists ${col}\\b`).test(SQL), `thiếu cột ${col}`);
  }
  assert.match(SQL, /enrichment_status in \('not_started','pending','processing','completed','insufficient_data','low_confidence','failed'\)/i);
  assert.match(SQL, /enrichment_source in \('auto_enrichment','manual_check'\)/i);
});

test("G3. index phục vụ worker (claim, lease, allowance theo user)", () => {
  for (const needle of [
    "auto_enrichment_jobs_claim_idx",
    "auto_enrichment_jobs_processing_idx",
    "auto_enrichment_jobs_user_dispatch_idx",
    "auto_enrichment_jobs_user_status_idx",
  ]) {
    assert.ok(statements(`create index if not exists ${needle}`).length > 0, `thiếu index ${needle}`);
  }
});

test("G4. migration idempotent (if not exists / drop policy if exists / create or replace)", () => {
  const bareCreateTable = statements("create table ").filter((s) => !/if not exists/i.test(s));
  const bareIndex = statements("create index ").filter((s) => !/if not exists/i.test(s));
  const bareUnique = statements("create unique index ").filter((s) => !/if not exists/i.test(s));
  const bareAddColumn = statements("add column ").filter((s) => !/if not exists/i.test(s));
  assert.deepEqual(bareCreateTable, [], `create table thiếu if not exists: ${bareCreateTable.join(" | ")}`);
  assert.deepEqual(bareIndex, [], `create index thiếu if not exists: ${bareIndex.join(" | ")}`);
  assert.deepEqual(bareUnique, [], `create unique index thiếu if not exists: ${bareUnique.join(" | ")}`);
  assert.deepEqual(bareAddColumn, [], `add column thiếu if not exists: ${bareAddColumn.join(" | ")}`);
  assert.ok(statements("drop policy if exists").length > 0, "phải drop policy if exists để chạy lại được");
  assert.ok(statements("create or replace function").length > 0, "phải create or replace function");
  // Không có câu DDL phá huỷ dữ liệu.
  assert.equal(/drop table/i.test(SQL), false, "không được drop table");
  assert.equal(/\btruncate\s+table\b/i.test(SQL), false, "không được TRUNCATE trong migration");
});

// ================================================================ H. migration 0021 (P1-1)

// 0021 chỉ thêm cột tuổi job chủ để phân giải ownership; không được nới lỏng bất
// cứ RLS/grant nào của 0019/0020 và không cần backfill.
/** Bỏ comment `--` để assert trên STATEMENT thật, không dính chữ trong comment. */
const SQL_0021_CODE = SQL_0021.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
test("H1. 0021 thêm đúng 1 cột nullable, idempotent", () => {
  const addCol = SQL_0021_CODE.match(/alter table public\.radar_matches add column if not exists enrichment_job_created_at timestamptz;/i);
  assert.ok(addCol, "thiếu alter table radar_matches add column if not exists enrichment_job_created_at timestamptz");
  assert.ok(/if not exists/i.test(SQL_0021_CODE), "phải idempotent");
  // Chỉ 1 cột mới: không lôi score/deal_type/is_ngop (signal thủ công) vào.
  const addCols = SQL_0021_CODE.match(/add column[^;]*/gi) ?? [];
  assert.equal(addCols.length, 1, `0021 chỉ được thêm 1 cột, thấy: ${addCols.join(" | ")}`);
  assert.equal(/\b(score|deal_type|is_ngop)\b/i.test(SQL_0021_CODE), false, "không được đụng cột signal thủ công");
});

test("H2. 0021 không làm yếu RLS/grant của 0019/0020", () => {
  assert.equal(/disable row level security/i.test(SQL_0021_CODE), false, "không được tắt RLS");
  assert.equal(/drop policy/i.test(SQL_0021_CODE), false, "không được drop policy");
  assert.equal(/\b(revoke|grant)\b/i.test(SQL_0021_CODE), false, "không được đổi quyền");
  assert.equal(/\bdrop\s+table\b/i.test(SQL_0021_CODE), false, "không được drop table");
  assert.equal(/\btruncate\s+table\b/i.test(SQL_0021_CODE), false, "không được TRUNCATE");
  // Không đòi backfill: cột nullable, không default, không update dữ liệu cũ.
  assert.equal(/\bupdate\b/i.test(SQL_0021_CODE), false, "0021 không được sửa dữ liệu cũ (không backfill)");
  assert.equal(/\bdelete\b/i.test(SQL_0021_CODE), false, "không được xoá dữ liệu");
});

// ================================================================ I. migration 0022
// Assert tĩnh trên SQL. Không chạy Postgres — không phải proof runtime.

function body0022(name: string): string {
  const start = SQL_0022.indexOf(`function public.${name}(`);
  assert.ok(start >= 0, `0022 thiếu function public.${name}`);
  const open = SQL_0022.indexOf("$$", start);
  const close = SQL_0022.indexOf("$$", open + 2);
  assert.ok(open >= 0 && close > open, `0022 function ${name} thiếu $$`);
  return flat(SQL_0022.slice(open + 2, close));
}

/** Cắt TỪNG câu `update public.auto_enrichment_jobs` trong thân hàm 0022.
 *  Bắt buộc vì `body` đã flatten: token `processing_started_at < now() - ...`
 *  tồn tại ở nhánh failed vẫn làm assert "coi chung" xanh, nên phải khoá theo
 *  từng statement mới kill được mutation bỏ guard ở nhánh requeue. */
function updateStatements0022(name: string): string[] {
  const body = body0022(name);
  const out: string[] = [];
  let idx = 0;
  for (;;) {
    const at = body.indexOf("update public.auto_enrichment_jobs", idx);
    if (at < 0) break;
    const end = body.indexOf(";", at);
    assert.ok(end > at, `update trong ${name} thiếu dấu ;`);
    out.push(body.slice(at, end + 1));
    idx = end + 1;
  }
  return out;
}

const SQL_0022_CODE = SQL_0022.replace(/--[^\n]*/g, "");

test("I1. reclaim so now() - interval, không nhận timestamp client làm đồng hồ", () => {
  const body = body0022("reclaim_stale_auto_enrichment_jobs");
  // TỪNG nhánh phải tự mang đủ guard lease. Chỉ assert token "tồn tại trong body"
  // là không đủ: bỏ lease ở nhánh requeue vẫn xanh vì nhánh failed còn giữ.
  const updates = updateStatements0022("reclaim_stale_auto_enrichment_jobs");
  assert.equal(updates.length, 2, "reclaim phải có 2 nhánh: requeue + failed");
  updates.forEach((u, i) => {
    assert.match(u, /where status = 'processing'/, `nhánh ${i + 1}: phải lọc status = 'processing'`);
    assert.match(
      u,
      /processing_started_at < now\(\) - make_interval\(secs => v_lease\)/,
      `nhánh ${i + 1}: phải lọc lease hết hạn theo giờ DB`,
    );
  });
  assert.match(body, /processing_started_at < now\(\) - make_interval\(secs => v_lease\)/);
  assert.match(body, /next_attempt_at = now\(\) \+ make_interval\(secs => v_backoff\)/);
  assert.match(body, /v_backoff := greatest\(coalesce\(p_backoff_seconds, 30\), 30\)/);
  assert.equal(/p_cutoff|cutoffISO|timestamptz/i.test(body), false, "không được có tham số giờ client");
  assert.equal(/\bdispatch_started_at\b/i.test(body), false, "reclaim không được xoá dispatch_started_at");
  assert.match(body, /attempts < coalesce\(p_max_attempts, 3\)/);
  assert.match(body, /attempts >= coalesce\(p_max_attempts, 3\)/);
});

test("I2. begin_auto_enrichment_dispatch_at trả mốc DB, charge-once, không đè hàm 0020", () => {
  const body = body0022("begin_auto_enrichment_dispatch_at");
  // Khoá ownership phải nằm TRONG câu lock. `claim_token = p_claim_token` xuất
  // hiện ở câu update phía dưới nên assert chung "có token" là xanh giả: bỏ
  // claim_token khỏi `select ... for update` vẫn pass, worker hết claim vẫn charge.
  const lock = body.match(
    /select user_id, dispatch_started_at into v_user, v_dispatch from public\.auto_enrichment_jobs where .*?for update;/i,
  );
  assert.ok(lock, "phải có select ... for update khoá job");
  assert.match(lock[0], /where id = p_job_id/, "lock phải khoá theo id");
  assert.match(lock[0], /and claim_token = p_claim_token/, "lock phải khoá theo claim_token");
  assert.match(lock[0], /and status = 'processing'/, "lock phải khoá theo status = 'processing'");
  // Mọi câu update trong hàm cũng phải giữ claim_token (trừ câu đã khớp lock).
  updateStatements0022("begin_auto_enrichment_dispatch_at").forEach((u, i) => {
    if (/set dispatch_started_at = now\(\)/.test(u) || /set attempts = attempts \+ 1/.test(u)) {
      assert.match(u, /where id = p_job_id and claim_token = p_claim_token/, `update ${i + 1}: phải khoá claim_token`);
    }
  });
  assert.match(body, /select user_id, dispatch_started_at into v_user, v_dispatch/);
  assert.match(body, /if v_dispatch is null then/);
  assert.match(body, /set dispatch_started_at = now\(\), allowance_consumed = true/);
  assert.match(body, /returning dispatch_started_at into v_dispatch/);
  assert.match(body, /return v_dispatch/);
  assert.match(body, /claim_token = p_claim_token/);
  assert.match(body, /where public\.auto_enrichment_allowance\.consumed < p_daily_limit/);
  assert.match(SQL_0022, /function public\.begin_auto_enrichment_dispatch_at\(/);
  assert.equal(/function public\.begin_auto_enrichment_dispatch\(/i.test(SQL_0022), false, "không thay chữ ký hàm 0020");
  assert.match(SQL, /function public\.begin_auto_enrichment_dispatch\(/);
});

test("I3. latest_manual_check_at lọc exact id trước limit 1, không like + limit 10", () => {
  const body = body0022("latest_manual_check_at");
  assert.match(body, /substring\(c\.listing_url from '\(\[0-9\]\+\)\\.htm\(\$\|\[\?#\]\)'\) = p_external_id/);
  assert.match(body, /c\.score is not null/);
  assert.match(body, /order by c\.created_at desc/);
  assert.match(body, /limit 1/);
  assert.equal(/\blike\b/i.test(body), false, "không like hậu tố");
  const whereAt = body.indexOf("where");
  const limitAt = body.indexOf("limit 1");
  assert.ok(whereAt >= 0 && whereAt < limitAt, "exact id phải đứng trước limit");
});

test("I4. trigger chặn pending đè processing, không tắt RLS, grant chỉ service_role", () => {
  const body = body0022("preserve_radar_match_processing");
  assert.match(body, /old\.enrichment_status = 'processing' and new\.enrichment_status = 'pending'/);
  assert.match(body, /new\.enrichment_status := old\.enrichment_status/);
  assert.match(body, /new\.enrichment_source := old\.enrichment_source/);
  assert.match(SQL_0022_CODE, /before update on public\.radar_matches/);
  assert.match(SQL_0022_CODE, /drop trigger if exists radar_matches_preserve_processing/);
  assert.equal(/disable row level security/i.test(SQL_0022_CODE), false);
  assert.equal(/\bdrop\s+table\b/i.test(SQL_0022_CODE), false);
  assert.equal(/\btruncate\s+table\b/i.test(SQL_0022_CODE), false);
  for (const fn of [
    "reclaim_stale_auto_enrichment_jobs(integer, integer, integer)",
    "begin_auto_enrichment_dispatch_at(uuid, uuid, integer)",
    "latest_manual_check_at(text)",
    "preserve_radar_match_processing()",
  ]) {
    assert.match(SQL_0022_CODE, new RegExp(`revoke all on function public\\.${fn.replace(/[()]/g, "\\$&")} from public, anon, authenticated`, "i"));
    assert.match(SQL_0022_CODE, new RegExp(`grant execute on function public\\.${fn.replace(/[()]/g, "\\$&")} to service_role`, "i"));
  }
  assert.equal(/grant execute on function public\.\w+.*to (anon|authenticated|public)/i.test(SQL_0022_CODE), false);
});

console.log(`\nauto-enrichment-migration-sql: ${failures} fail`);
process.exitCode = failures ? 1 : 0;