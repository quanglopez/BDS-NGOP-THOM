// Phase 12 — Application Score Cache (/api/check read-through).
// 16 case: miss lưu key+model, hit không gọi Jev/không insert row mới,
// scope theo user, key đổi khi state/version đổi, malformed không cache,
// lookup lỗi fail-open, provider_model_id fallback header, race 23505.
// Harness: node --experimental-strip-types (không module mocking — bơm
// deps qua CheckDeps, fake Supabase stateful theo row thật).
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckDeps } from "@/lib/check-route";
import { detectProvince, provinceLabel } from "@/lib/provinces";
import { CHECK_QUESTIONS, sha256Hex } from "@/lib/ai/jev-check";
import { SCORING_CODE_VERSION } from "@/lib/scoring";
import { canonicalJevRequest, scoringCacheKey } from "@/lib/scoring-cache";

const TEXT =
  "Cần Thơ, 3x15m, 1 trệt 2 lầu, 4PN, 5WC, giá 4,3 tỷ. SĐT 0909123456";
const TEXT_SAME_PROVINCE =
  "Cần Thơ, 4x18m, 1 trệt 1 lầu, giá 5 tỷ. SĐT 0909111111";

/** Canonical state route dựng cho Jev — trùng công thức thật. */
const stateFor = (text: string) =>
  `Khu vực: ${provinceLabel(detectProvince(text))}\n${text.slice(0, 5900)}`;

interface Opts {
  score?: unknown;
  model?: string;
  jevHeaders?: Record<string, string>;
  rows?: Record<string, unknown>[];
  userId?: string;
  lookupError?: string;
  raceWinner?: Record<string, unknown>;
  rateLimited?: boolean;
  credits?: number;
  quotaUsed?: number;
}

/** Admin giả (service role): nhận mọi UPDATE, KHÔNG bao giờ ném lỗi. */
function fakeAdmin() {
  const updates: Record<string, unknown>[] = [];
  const q = {
    select: () => q,
    eq: () => q,
    or: () => q,
    maybeSingle: async () => ({ data: null, error: null }),
    update: (patch: Record<string, unknown>) => {
      updates.push({ table: "checks", ...patch });
      return q;
    },
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: null, error: null }),
  };
  const client = { from: () => q } as unknown as SupabaseClient;
  return { client, updates };
}

function makeDeps(o: Opts = {}) {
  const rows = o.rows ?? ([] as Record<string, unknown>[]);
  const userId = o.userId ?? "u-1";
  const inserts: Record<string, unknown>[] = [];
  const usersUpdates: Record<string, unknown>[] = [];
  let jevCalls = 0;
  let cacheQueries = 0;
  let maybeSingleCalls = 0;

  const usersQuery = {
    select: () => usersQuery,
    eq: () => usersQuery,
    single: async () => ({
      data: {
        plan: "free",
        credits: o.credits ?? 0,
        plan_expires_at: "2099-01-01T00:00:00Z",
      },
      error: null,
    }),
    update: (patch: Record<string, unknown>) => {
      usersUpdates.push(patch);
      return usersQuery;
    },
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: null, error: null, count: 0 }),
  };

  const applyUpdate = (q: Record<string, unknown>) => {
    const filters = q._filters as Array<[string, unknown]>;
    const idFilter = filters.find(([c]) => c === "id");
    if (!idFilter) return;
    const row = rows.find((r) => r.id === idFilter[1]);
    if (row) Object.assign(row, q._pendingUpdate);
    q._pendingUpdate = null;
  };

  const makeChecksQuery = () => {
    const q: Record<string, unknown> = {
      _filters: [] as Array<[string, unknown]>,
      _pendingUpdate: null as Record<string, unknown> | null,
      _inserted: null as Record<string, unknown> | null,
      _insertError: null as { code: string } | null,
      // race: chỉ insert ĐẦU TIÊN (của deps này) bị 23505;
      // `inserts` shared cross-query nên one-shot đúng scope.
      select: () => q,
      eq: (col: string, val: unknown) => {
        (q._filters as Array<[string, unknown]>).push([col, val]);
        if (q._pendingUpdate) applyUpdate(q);
        return q;
      },
      gte: () => q,
      order: () => q,
      limit: () => q,
      not: () => q,
      maybeSingle: async () => {
        cacheQueries++;
        maybeSingleCalls++;
        if (o.lookupError) {
          return { data: null, error: { code: o.lookupError } };
        }
        if (o.raceWinner) {
          // Race: lookup đầu miss (winner chưa commit), lookup fallback
          // (sau 23505) thấy winner — đúng timeline thật.
          return maybeSingleCalls === 1
            ? { data: null, error: null }
            : { data: o.raceWinner, error: null };
        }
        const hit =
          rows.find(
            (r) =>
              r.score != null &&
              (q._filters as Array<[string, unknown]>).every(([c, v]) => r[c] === v),
          ) ?? null;
        return { data: hit, error: null };
      },
      single: async () => ({
        data: q._inserted
          ? { id: (q._inserted as Record<string, unknown>).id, created_at: (q._inserted as Record<string, unknown>).created_at }
          : null,
        error: q._insertError,
      }),
      insert: (payload: Record<string, unknown>) => {
        inserts.push(payload);
        if (o.raceWinner && inserts.length === 1) {
          q._insertError = { code: "23505" };
          return q;
        }
        const dup =
          typeof payload.scoring_cache_key === "string" &&
          rows.some(
            (r) =>
              r.user_id === payload.user_id &&
              r.scoring_cache_key === payload.scoring_cache_key,
          );
        if (dup) {
          q._insertError = { code: "23505" };
          return q;
        }
        const row = {
          id: `check-${rows.length + 1}`,
          created_at: "2026-10-06T00:00:00Z",
          seo_slug: null,
          ...payload,
        };
        rows.push(row);
        q._inserted = row;
        return q;
      },
      update: (patch: Record<string, unknown>) => {
        q._pendingUpdate = patch;
        return q;
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (q._pendingUpdate) applyUpdate(q);
        return resolve({ data: null, error: null, count: o.quotaUsed ?? 0 });
      },
    };
    return q;
  };

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    from: (table: string) => (table === "users" ? usersQuery : makeChecksQuery()),
  } as unknown as SupabaseClient;

  const callJev = async () => {
    jevCalls++;
    const body: Record<string, unknown> = {
      answers: {
        investment_potential: { score: o.score ?? 3 },
        deal_type: { choice: "binh_thuong", confidence: 0.7 },
        is_ngop: { noul: 0.2 },
        legal_safety: { noul: 0 },
        location_growth: { score: 3 },
        liquidity: { score: 3 },
      },
    };
    if (o.model !== undefined) body.model = o.model;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: o.jevHeaders ?? {},
    });
  };

  const rateLimit = o.rateLimited
    ? async () => ({ allowed: false })
    : async () => ({ allowed: true });

  const admin = fakeAdmin();
  return {
    rows,
    inserts,
    usersUpdates,
    deps: {
      createSupabaseClient: async () => client,
      rateLimit,
      callJev,
      adminClient: () => admin.client,
    } as unknown as CheckDeps,
    jevCalls: () => jevCalls,
    cacheQueries: () => cacheQueries,
  };
}

const req = (text: string) =>
  new NextRequest("http://localhost:3000/api/check", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ text }),
  });

type PostArg = CheckDeps & { params: Promise<unknown> };

const post = (d: CheckDeps, text = TEXT) =>
  mod.POST(req(text), { ...d, params: Promise.resolve({}) } as PostArg);

process.env.JEV_API_KEY = "test-key";
// Dynamic import exception: phải set env TRƯỚC khi load route
// (harness strip-types); khớp convention tests/check-route-score.test.ts.
const mod = await import("@/app/api/check/route");
assert.equal(typeof mod.POST, "function");

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

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

await test("1. miss: insert payload carries scoring_cache_key + provider_model_id (body model)", async () => {
  const d = makeDeps({ model: "jev-1.13.0" });
  const res = await post(d.deps);
  assert.equal(res.status, 200);
  const expectedKey = await scoringCacheKey(stateFor(TEXT));
  assert.equal(d.inserts.length, 1);
  assert.equal(d.inserts[0].scoring_cache_key, expectedKey);
  assert.equal(d.inserts[0].provider_model_id, "jev-1.13.0");
});

await test("2. hit: same user + same text -> KHÔNG gọi Jev, tạo history row (key NULL), check_id mới, cached=true", async () => {
  const rows: Record<string, unknown>[] = [];
  const first = makeDeps({ rows });
  const res1 = await post(first.deps);
  const body1 = await json(res1);
  assert.equal(res1.status, 200);
  assert.equal(body1.cached, false);

  const second = makeDeps({ rows });
  const res2 = await post(second.deps);
  const body2 = await json(res2);
  assert.equal(res2.status, 200);
  assert.equal(second.jevCalls(), 0);
  assert.equal(second.inserts.length, 1); // history copy
  assert.equal(second.inserts[0].scoring_cache_key, null);
  assert.equal(second.inserts[0].user_id, rows[0].user_id);
  assert.equal(second.inserts[0].score, body1.investment_score);
  assert.equal(body2.cached, true);
  assert.notEqual(body2.check_id, body1.check_id);
  assert.equal(body2.investment_score, body1.investment_score);
  assert.equal(second.usersUpdates.length, 0); // quota days còn lượt → không trừ credits
  assert.equal(rows.length, 2); // 1 cache row + 1 history row
  assert.equal(rows.filter((r) => typeof r.scoring_cache_key === "string").length, 1);
});

await test("3. different user, same text -> MISS (cache scope theo user_id)", async () => {
  const rows: Record<string, unknown>[] = [];
  const first = makeDeps({ rows, userId: "u-1" });
  await post(first.deps);
  const second = makeDeps({ rows, userId: "u-2" });
  const res = await post(second.deps);
  assert.equal(res.status, 200);
  assert.equal(second.jevCalls(), 1);
  assert.equal(second.inserts.length, 1);
});

await test("4. same user, different text -> MISS", async () => {
  const rows: Record<string, unknown>[] = [];
  const first = makeDeps({ rows });
  await post(first.deps);
  const second = makeDeps({ rows });
  const res = await post(second.deps, TEXT_SAME_PROVINCE);
  assert.equal(res.status, 200);
  assert.equal(second.jevCalls(), 1);
  assert.equal(second.inserts.length, 1);
});

await test("5. key deterministic: same canonical state -> same key", async () => {
  const s = stateFor(TEXT);
  assert.equal(await scoringCacheKey(s), await scoringCacheKey(s));
});

await test("6. key differs when state differs (tỉnh khác / text khác)", async () => {
  assert.notEqual(await scoringCacheKey(stateFor(TEXT)), await scoringCacheKey(stateFor(TEXT_SAME_PROVINCE)));
});

await test("7. key differs when scoring_code_version changes", async () => {
  const s = stateFor(TEXT);
  const other = sha256Hex(JSON.stringify(canonicalJevRequest(s)) + "jev-v2");
  assert.notEqual(await scoringCacheKey(s), other);
});

await test("8. malformed JEV score -> 502, KHÔNG cache; retry gọi Jev lại", async () => {
  const rows: Record<string, unknown>[] = [];
  const first = makeDeps({ rows, score: "abc" });
  const res1 = await post(first.deps);
  assert.equal(res1.status, 502);
  assert.equal(rows.length, 0);

  const second = makeDeps({ rows, score: "abc" });
  const res2 = await post(second.deps);
  assert.equal(res2.status, 502);
  assert.equal(second.jevCalls(), 1);
  assert.equal(second.cacheQueries(), 1);
  assert.equal(rows.length, 0);
});

await test("9. cache lookup error -> fail-open: Jev vẫn gọi, response 200", async () => {
  const d = makeDeps({ lookupError: "42P01" });
  const res = await post(d.deps);
  assert.equal(res.status, 200);
  assert.equal(d.jevCalls(), 1);
  assert.equal(d.inserts.length, 1);
});

await test("10. provider_model_id fallback: header x-model khi body không có model", async () => {
  const d = makeDeps({ jevHeaders: { "x-model": "jev-1.13.0" } });
  const res = await post(d.deps);
  assert.equal(res.status, 200);
  assert.equal(d.inserts[0].provider_model_id, "jev-1.13.0");
});

await test("11. provider_model_id = null khi provider không báo model", async () => {
  const d = makeDeps({});
  const res = await post(d.deps);
  assert.equal(res.status, 200);
  assert.equal(d.inserts[0].provider_model_id, null);
});

await test("12. hit preserves sub-score conversions (noul->%, score 0..4->100) + confidence", async () => {
  const rows: Record<string, unknown>[] = [];
  const first = makeDeps({ rows });
  const res1 = await post(first.deps);
  const body1 = await json(res1);
  assert.equal(body1.is_ngop, 20);
  assert.equal(body1.location_growth, 75);
  assert.equal(body1.confidence, 0.7);

  const second = makeDeps({ rows });
  const res2 = await post(second.deps);
  const body2 = await json(res2);
  assert.equal(body2.cached, true);
  assert.equal(body2.is_ngop, 20);
  assert.equal(body2.location_growth, 75);
  assert.equal(body2.liquidity, 75);
  assert.equal(body2.confidence, 0.7);
  assert.equal(body2.deal_type, body1.deal_type);
});

await test("13. repeated hits: chỉ 1 cache row (key non-null), mỗi hit 1 history row, 0 Jev", async () => {
  const rows: Record<string, unknown>[] = [];
  const first = makeDeps({ rows });
  await post(first.deps);
  const second = makeDeps({ rows });
  await post(second.deps);
  const third = makeDeps({ rows });
  await post(third.deps);
  assert.equal(rows.length, 3);
  assert.equal(third.jevCalls(), 0);
  assert.equal(rows.filter((r) => typeof r.scoring_cache_key === "string").length, 1);
});

await test("14. rate limited -> 429, không query cache, không gọi Jev", async () => {
  const d = makeDeps({ rateLimited: true });
  const res = await post(d.deps);
  assert.equal(res.status, 429);
  assert.equal(d.cacheQueries(), 0);
  assert.equal(d.jevCalls(), 0);
  assert.equal(d.inserts.length, 0);
});

await test("15. key formula locked: SHA-256(JSON(canonical request) + SCORING_CODE_VERSION)", async () => {
  const state = stateFor(TEXT);
  const expected = await sha256Hex(
    JSON.stringify({ model: "jev-latest", state, questions: CHECK_QUESTIONS }) +
      SCORING_CODE_VERSION,
  );
  assert.equal(await scoringCacheKey(state), expected);
});

await test("16. insert race (23505) -> winner row reused cho scoring, request thua vẫn có history copy", async () => {
  const winner = {
    id: "check-winner",
    user_id: "u-1",
    scoring_cache_key: await scoringCacheKey(stateFor(TEXT)),
    score: 42,
    deal_type: "binh_thuong",
    is_ngop: 20,
    province: null,
    price_billion: null,
    area_m2: null,
    bedrooms: null,
    seo_slug: null,
    created_at: "2026-10-05T00:00:00Z",
    jev_deal_confidence: 0.7,
    jev_is_ngop: 0.2,
    jev_legal_safety: 0,
    jev_location_growth: 3,
    jev_liquidity: 3,
  };
  // raceWinner chỉ set error cho insert ĐẦU TIÊN của deps này.
  // Route insert → 23505 → lookupCacheRow() → winner → cachedHistoryResponse.
  const d = makeDeps({ raceWinner: winner, rows: [winner] });
  const res = await post(d.deps);
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.cached, true);
  assert.equal(body.investment_score, 42);
  assert.equal(d.jevCalls(), 1);
  // 2 inserts: lần 1 (miss path, bị 23505) + lần 2 (history copy key NULL)
  assert.equal(d.inserts.length, 2);
  assert.equal(typeof d.inserts[0].scoring_cache_key, "string");
  assert.equal(d.inserts[1].scoring_cache_key, null);
  assert.notEqual(body.check_id, "check-winner");
});

await test("17. cache HIT qua nhánh credit khi day quota đã đầy -> trừ đúng 1 credit", async () => {
  // quotaUsed=20 KHÔNG phải bypass quota gate: gate thấy used>=limit nhưng
  // credits=1 -> usingCredit=true -> request được authorize qua credit.
  // quota row vẫn đếm vào used (20 -> 21), credits 1 -> 0, đúng 1 lần trừ.
  const source = {
    id: "check-src",
    user_id: "u-1",
    scoring_cache_key: await scoringCacheKey(stateFor(TEXT)),
    score: 42,
    deal_type: "binh_thuong",
    is_ngop: 20,
    province: null,
    price_billion: null,
    area_m2: null,
    bedrooms: null,
    created_at: "2026-10-05T00:00:00Z",
    jev_deal_confidence: 0.7,
    jev_is_ngop: 0.2,
    jev_legal_safety: 0,
    jev_location_growth: 3,
    jev_liquidity: 3,
  };
  const rows: Record<string, unknown>[] = [source];
  const d = makeDeps({ rows, quotaUsed: 20, credits: 1 });
  const res = await post(d.deps);
  const body = await json(res);
  assert.equal(res.status, 200);
  assert.equal(d.jevCalls(), 0);
  assert.equal(d.usersUpdates.length, 1);
  assert.deepEqual(d.usersUpdates[0], { credits: 0 });
  assert.equal(body.cached, true);
  assert.equal(body.quota.credits, 0);
  assert.equal(body.quota.used, 21);
});

await test("18. HIT/HIT song song cùng user+key: 1 cache row, 2 history rows, 0 Jev", async () => {
  const rows: Record<string, unknown>[] = [];
  const first = makeDeps({ rows });
  await post(first.deps);

  const a = makeDeps({ rows });
  const b = makeDeps({ rows });
  const [ra, rb] = await Promise.all([post(a.deps), post(b.deps)]);
  const [ba, bb] = await Promise.all([json(ra), json(rb)]);
  assert.equal(ra.status, 200);
  assert.equal(rb.status, 200);
  assert.equal(a.jevCalls() + b.jevCalls(), 0);
  assert.equal(ba.cached, true);
  assert.equal(bb.cached, true);
  assert.equal(ba.investment_score, bb.investment_score);
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((r) => typeof r.scoring_cache_key === "string").length, 1);
  // Cả 2 history copy của cùng source
  assert.equal(rows.filter((r) => r.scoring_cache_key === null).length, 2);
});

console.log(`scoring-cache: ${18 - failures}/18 pass`);
if (failures > 0) process.exit(1);
