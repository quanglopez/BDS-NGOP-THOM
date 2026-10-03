// Self-check: guard malformed-score của POST /api/check (route THẬT).
//
// Regression cần khoá: FIX 7 cho Check thủ công (`checkInvestmentVerdict` -> 502)
// từng KHÔNG có test ở tầng route. Mutation đổi `decided.score` về
// `investmentScore100(...) ?? 0` làm cả suite vẫn xanh trong khi tin sai lại
// bị persist `score = 0` -> Radar mọc signal giả.
//
// Cách làm: import route /api/check thật, bơm deps giả qua tham số thứ 2 của
// POST. KHÔNG module mocking (harness node --experimental-strip-types không
// hỗ trợ). Không chạm Supabase/Jev thật: deps giả thay cả hai.
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import type { CheckDeps } from "@/lib/check-route";

// 90% khối lượt ghi vào `checks` mà handler tạo trước khi trả 200.
const TEXT =
  "Bán nhà Vũng Tàu trung tâm Đà Nẵng đường 2 chiều, diện tích 80m2, giá 4 tỷ 200 triệu, sổ hồng chính chủ.";

/** Supabase giả: ghi lại MỌI lệnh, đủ cho truy vấn TRƯỚC và TẠI chỗ insert. */
function recordingSupabase() {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  // Bảng users: profile trả quota đủ dùng (free, hết hạn sau, credits 0).
  const usersQuery = {
    select: () => usersQuery,
    eq: () => usersQuery,
    single: async () => ({
      data: { plan: "free", credits: 0, plan_expires_at: "2099-01-01T00:00:00Z" },
      error: null,
    }),
    update: (patch: Record<string, unknown>) => {
      updates.push({ table: "users", ...patch });
      return usersQuery;
    },
    then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null, count: 0 }),
  };

  // Bảng checks: count cho quota + insert có ghi lại payload.
  const checksQuery = {
    select: () => checksQuery,
    eq: () => checksQuery,
    gte: () => checksQuery,
    single: async () => ({ data: { id: "check-1" }, error: null }),
    insert: (payload: Record<string, unknown>) => {
      inserts.push(payload);
      return checksQuery;
    },
    update: (patch: Record<string, unknown>) => {
      updates.push({ table: "checks", ...patch });
      return checksQuery;
    },
    then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null, count: 0 }),
  };

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
    from: (table: string) => (table === "users" ? usersQuery : checksQuery),
  } as unknown as SupabaseClient;

  return { client, inserts, updates };
}

function fakeJev(score: unknown) {
  return async () =>
    new Response(
      JSON.stringify({
        answers: {
          investment_potential: { score },
          deal_type: { choice: "binh_thuong", confidence: 0.7 },
          is_ngop: { noul: 0 },
          legal_safety: { noul: 0 },
          location_growth: { score: 3 },
          liquidity: { score: 3 },
        },
      }),
      { status: 200 },
    );
}

/** Admin giả (service role): nhận mọi UPDATE, KHÔNG bao giờ ném lỗi ra ngoài. */
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
    then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
  };
  const client = { from: () => q } as unknown as SupabaseClient;
  return { client, updates };
}

/** Deps đầy đủ cho một lượt check thành công (hoặc dừng 502 ở guard score). */
function deps(score: unknown) {
  const sb = recordingSupabase();
  const admin = fakeAdmin();
  return {
    calls: { sb: sb, admin: admin, inserts: sb.inserts, adminUpdates: admin.updates },
    deps: {
      createSupabaseClient: async () => sb.client,
      rateLimit: async () => ({ allowed: true, remaining: 10, resetAt: Date.now() + 60_000 }),
      callJev: fakeJev(score) as unknown as CheckDeps["callJev"],
      adminClient: () => admin.client,
    } satisfies CheckDeps,
  };
}

const req = () =>
  new NextRequest("http://localhost:3000/api/check", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ text: TEXT }),
  });

/** Tham số thứ 2 của POST thật = deps + `params` (Next 15.5 yêu cầu tham số
 *  thứ 2 khớp RouteContext). Guard runtime chỉ đọc 4 field deps. */
type PostArg = CheckDeps & { params: Promise<unknown> };

/** Context kiểu Next: KHÔNG phải deps -> shim phải rơi về wiring thật. */
const NEXT_CONTEXT = { params: Promise.resolve({}) } as unknown as PostArg;

/** POST thật + deps giả. */
const post = (d: CheckDeps) => mod.POST(req(), { ...d, params: Promise.resolve({}) });

// Guard của route đọc process.env trực tiếp (không phá: đọc env là hành vi
// thật, chỉ bơm deps cho Supabase/Jev). Test smoke 10/11 tự xoá và trả lại.
process.env.JEV_API_KEY = "test-key";

// POST thật (route đã import ở trên). Module phải export đúng hàm.
const mod = await import("@/app/api/check/route");
assert.equal(typeof mod.POST, "function");

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  ok  ${name}`); } catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
}

// ------------------------------------------------- guard malformed-score

await test("1. score \"abc\" (chuỗi rác) -> 502, KHÔNG ghi checks, không có score 0", async () => {
  const { calls, deps: d } = deps("abc");
  const res = await post(d);
  assert.equal(res.status, 502, "malformed phải chặn bằng 502, không phải fallback 0");
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.error, "Jev trả về dữ liệu không hợp lệ");
  assert.equal(calls.inserts.length, 0, "KHÔNG được insert khi score hỏng");
  assert.equal(
    calls.inserts.filter((p) => p.score === 0).length,
    0,
    "nghiêm cấm: ghi 0 xuống checks sẽ thành Radar signal giả",
  );
});

await test("2. score 0 (số 0 THẬT) -> 200 và persist đúng 0 (0 khác invalid)", async () => {
  const { calls, deps: d } = deps(0);
  const res = await post(d);
  assert.equal(res.status, 200);
  assert.equal(calls.inserts.length, 1, "score hợp lệ phải persist đúng 1 lần");
  const payload = calls.inserts[0] as { score?: unknown };
  // 0 phải có mặt, không bị null/undefined — đây là điểm phân biệt 0 thật và hỏng.
  assert.ok(payload.score !== null && payload.score !== undefined, "score không được null/undefined");
  assert.equal(payload.score, 0, "score 0 thật phải được giữ nguyên, không rơi về null");
});

await test("3. score \"3\" (chuỗi SỐ) -> 200 và persist 75, không 0", async () => {
  const { calls, deps: d } = deps("3");
  const res = await post(d);
  assert.equal(res.status, 200);
  assert.equal(calls.inserts.length, 1);
  const payload = calls.inserts[0] as { score?: unknown };
  assert.equal(payload.score, 75, 'chuỗi số "3" quy thang 100 = 75, không phải 0');
  assert.notEqual(payload.score, 0);
});

// Chạy đúng cửa guard cho từng dạng rác thường gặp từ provider.
await test("4. ma trận rác (null/undefined/NaN/\"\"/{}) -> 502, KHÔNG gì xuống checks", async () => {
  const bad: [string, unknown][] = [
    ["null", null],
    ["undefined (thiếu field)", undefined],
    ["NaN", NaN],
    ["chuỗi rỗng", ""],
    ["object", {}],
    ["array", []],
    ["boolean", true],
  ];
  for (const [label, value] of bad) {
    const { calls, deps: d } = deps(value);
    const res = await post(d);
    assert.equal(res.status, 502, `${label} phải 502`);
    assert.equal(calls.inserts.length, 0, `${label} không được insert`);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, "Jev trả về dữ liệu không hợp lệ", `${label} trả đúng thông điệp`);
  }
});

await test("5. quy đổi thang 100 ở tầng route (không hardcode trong route)", async () => {
  for (const [raw, expected] of [["0", 0], [0, 0], ["1", 25], ["2", 50], ["3", 75], ["4", 100], [5, 5]] as const) {
    const { calls, deps: d } = deps(raw);
    const res = await post(d);
    assert.equal(res.status, 200, `score ${String(raw)} phải 200`);
    assert.equal(calls.inserts.length, 1);
    assert.equal(calls.inserts[0]!.score, expected, `score ${String(raw)} -> thang 100 không đúng`);
  }
});

await test("6. login/bảo trì KHÔNG đổi: thiếu user -> 401, không gọi Jev", async () => {
  const sb = recordingSupabase();
  const admin = fakeAdmin();
  let jevCalls = 0;
  const d: CheckDeps = {
    createSupabaseClient: async () => ({
      ...sb,
      auth: { getUser: async () => ({ data: { user: null } }) },
    } as unknown as SupabaseClient),
    rateLimit: async () => ({ allowed: true, remaining: 10, resetAt: Date.now() + 60_000 }),
    callJev: (async () => { jevCalls++; return new Response("{}", { status: 200 }); }) as unknown as CheckDeps["callJev"],
    adminClient: () => admin.client,
  };
  const res = await post(d);
  assert.equal(res.status, 401);
  assert.equal(jevCalls, 0, "thiếu user phải chặn TRƯỚC khi tốn tiền gọi AI");
  assert.equal(sb.inserts.length, 0);
});

await test("7. rate limit chặn trước khi tốn phí -> 429, KHÔNG persist", async () => {
  const sb = recordingSupabase();
  const admin = fakeAdmin();
  const d: CheckDeps = {
    createSupabaseClient: async () => sb.client,
    rateLimit: async () => ({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 }),
    callJev: (async () => new Response("{}", { status: 200 })) as unknown as CheckDeps["callJev"],
    adminClient: () => admin.client,
  };
  const res = await post(d);
  assert.equal(res.status, 429, "rate limit gần hết phải chặn trước khi tốn phí");
  assert.equal(sb.inserts.length, 0, "không được ghi checks khi bị rate limit");
});

await test("8. tin quá ngắn -> 400, không chạm Supabase/Jev", async () => {
  const sb = recordingSupabase();
  const admin = fakeAdmin();
  let jevCalls = 0;
  const d: CheckDeps = {
    createSupabaseClient: async () => sb.client,
    rateLimit: async () => ({ allowed: true, remaining: 10, resetAt: Date.now() + 60_000 }),
    callJev: (async () => { jevCalls++; return new Response("{}", { status: 200 }); }) as unknown as CheckDeps["callJev"],
    adminClient: () => admin.client,
  };
  const short = new NextRequest("http://localhost:3000/api/check", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ text: "ngắn" }),
  });
  const res = await mod.POST(short, { ...d, params: Promise.resolve({}) });
  assert.equal(res.status, 400);
  assert.equal(jevCalls, 0);
  assert.equal(sb.inserts.length, 0);
});

// ---------------------------------------- smoke wiring thật (không bypass deps)

await test("9. shim KHÔNG bypass deps: thiếu JEV_API_KEY -> 500 (default wiring thật)", async () => {
  // Route thật + deps thật (chỉ truyền context kiểu Next): guard chặn TRƯỚC
  // khi tạo Supabase/Jev nên không chạm service ngoài.
  const saved = process.env.JEV_API_KEY;
  delete process.env.JEV_API_KEY;
  try {
    const res = await mod.POST(req(), NEXT_CONTEXT);
    assert.equal(res.status, 500, "thiếu key phải 500");
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, "Chưa cấu hình JEV_API_KEY trên Vercel");
  } finally {
    if (saved !== undefined) process.env.JEV_API_KEY = saved;
    else delete process.env.JEV_API_KEY;
  }
});

await test("10. shim dùng deps thật: tin ngắn -> 400 (không cần key/Jev)", async () => {
  const saved = process.env.JEV_API_KEY;
  delete process.env.JEV_API_KEY;
  try {
    const short = new NextRequest("http://localhost:3000/api/check", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ text: "quá ngắn" }),
    });
    const res = await mod.POST(short, NEXT_CONTEXT);
    assert.equal(res.status, 400);
  } finally {
    if (saved !== undefined) process.env.JEV_API_KEY = saved;
    else delete process.env.JEV_API_KEY;
  }
});

await test("11. route thật KHÔNG nhận context route làm deps (Next truyền params)", async () => {
  // Next gọi handler(req, context). Nếu shim coi context là deps thì mọi
  // request check sẽ vỡ -> khóa điều này lại.
  const saved = process.env.JEV_API_KEY;
  delete process.env.JEV_API_KEY;
  try {
    const res = await mod.POST(req(), NEXT_CONTEXT);
    assert.equal(res.status, 500, "context không phải CheckDeps phải rơi về deps thật");
  } finally {
    if (saved !== undefined) process.env.JEV_API_KEY = saved;
    else delete process.env.JEV_API_KEY;
  }
});

console.log(`\ncheck-route-score: ${failures} fail`);
process.exitCode = failures ? 1 : 0;
