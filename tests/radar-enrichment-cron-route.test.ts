// Self-check: cron route /api/cron/radar-enrichment.
// Import route THẬT (không assert source string), override dependency qua
// handleEnrichmentCron: không chạm production DB, không gọi AI.
import assert from "node:assert/strict";
import { handleEnrichmentCron, ENRICHMENT_ROUTE_LIMITS } from "@/lib/radar/enrichment-cron";
import { runEnrichmentWorker, ENRICHMENT_WORKER_LIMITS, type EnrichmentWorkerStore } from "@/lib/radar/enrichment-worker";
import type { AutoProviderOutcome } from "@/lib/radar/auto-enrollment";

const SECRET = "cron-secret-test-1234567890";
const ENV_OK: Record<string, string | undefined> = { CRON_SECRET: SECRET, JEV_API_KEY: "jev-key-test" };

type Deps = Parameters<typeof handleEnrichmentCron>[1];
type StoreArgs = Parameters<typeof runEnrichmentWorker>[0];

interface Call {
  created: number;
  providerKeys: string[];
  workerArgs: StoreArgs[];
}

/** Store rỗng: chỉ để chứng minh route truyền đúng store xuống worker. */
function stubStore(): EnrichmentWorkerStore {
  const noop = async () => undefined;
  return {
    reclaimStaleProcessing: async () => ({ requeued: 0, failed: 0 }),
    claimPending: async () => [],
    isPlanPro: async () => true,
    beginDispatch: async () => true,
    markMatchProcessing: noop,
    releaseToPending: noop,
    markTerminal: noop,
    latestManualCheckAt: async () => null,
    persistMatchEnrichment: noop,
  } as unknown as EnrichmentWorkerStore;
}

/** Worker thật (không phải stub) với provider giả: chứng minh contract + limits
 *  của production, và trả về số tham số đã nhận. */
function deps(over: { env?: Record<string, string | undefined>; runWorker?: Deps["runWorker"] } = {}): { deps: Deps; calls: Call } {
  const calls: Call = { created: 0, providerKeys: [], workerArgs: [] };
  return {
    calls,
    deps: {
      env: over.env ?? ENV_OK,
      createStore: () => {
        calls.created++;
        return stubStore();
      },
      createProvider: (key: string) => {
        calls.providerKeys.push(key);
        return async (): Promise<AutoProviderOutcome> => ({ kind: "insufficient_data" });
      },
      runWorker: over.runWorker ?? (async (args: StoreArgs) => {
        calls.workerArgs.push(args);
        return runEnrichmentWorker(args);
      }),
    },
  };
}

const req = (auth?: string) =>
  new Request("https://app.example/api/cron/radar-enrichment", {
    headers: auth === undefined ? {} : { authorization: auth },
  });

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  ok  ${name}`); } catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
}

// ---------------------------------------------------------------- auth

await test("1. thiếu Authorization -> 401", async () => {
  const { deps: d, calls } = deps();
  const res = await handleEnrichmentCron(req(), d);
  assert.equal(res.status, 401);
  assert.equal(calls.created, 0, "401 phải chặn TRƯỚC khi tạo store/claim job");
});

await test("2. CRON_SECRET missing -> 500, không chạy worker", async () => {
  const { deps: d, calls } = deps({ env: { JEV_API_KEY: "k" } });
  const res = await handleEnrichmentCron(req(`Bearer ${SECRET}`), d);
  assert.equal(res.status, 500);
  assert.equal(calls.created, 0);
});

await test("3. CRON_SECRET sai -> 401", async () => {
  const { deps: d, calls } = deps();
  const res = await handleEnrichmentCron(req("Bearer wrong-secret-value-000000"), d);
  assert.equal(res.status, 401);
  assert.equal(calls.created, 0);
});

await test("4. length guard: token khác độ dài không làm throw (timingSafeEqual cần length bằng)", async () => {
  const { deps: d } = deps();
  for (const bad of ["Bearer s", "Bearer " + "x".repeat(200), "Bearer ", "token=" + SECRET]) {
    const res = await handleEnrichmentCron(req(bad), d);
    assert.equal(res.status, 401, `token "${bad.slice(0, 24)}" phải 401`);
  }
});

await test("4b. Bearer/case-insensitive + khoảng trắng thừa vẫn hợp lệ", async () => {
  const { deps: d, calls } = deps();
  const res = await handleEnrichmentCron(req(`bearer  ${SECRET} `), d);
  assert.equal(res.status, 200);
  assert.equal(calls.created, 1);
});

// ---------------------------------------------------------------- guards

await test("5. JEV_API_KEY missing -> 500, KHÔNG claim job (không tiêu allowance)", async () => {
  const { deps: d, calls } = deps({ env: { CRON_SECRET: SECRET } });
  const res = await handleEnrichmentCron(req(`Bearer ${SECRET}`), d);
  assert.equal(res.status, 500);
  assert.equal(calls.created, 0, "thiếu key thì không được tạo store");
  assert.equal(calls.workerArgs.length, 0);
});

await test("6. kill switch / cost guard short-circuit TRƯỚC khi tạo store", async () => {
  for (const [env, skipped] of [
    [{ AUTO_ENRICHMENT_KILL_SWITCH: "1" }, "kill_switch"],
    [{ AUTO_ENRICHMENT_COST_GUARD: "1" }, "cost_guard"],
  ] as const) {
    const { deps: d, calls } = deps({ env: { ...ENV_OK, ...env } });
    const res = await handleEnrichmentCron(req(`Bearer ${SECRET}`), d);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.skipped, skipped);
    assert.equal(calls.created, 0, `${skipped} phải dừng trước claim`);
    assert.equal(calls.providerKeys.length, 0);
  }
});

// ---------------------------------------------------------------- contract

await test("7. limits production: maxJobs/maxAttempts/lease khớp config dùng thật", async () => {
  assert.equal(ENRICHMENT_WORKER_LIMITS.maxJobs, ENRICHMENT_ROUTE_LIMITS.maxJobs);
  assert.equal(ENRICHMENT_WORKER_LIMITS.maxAttempts, ENRICHMENT_ROUTE_LIMITS.maxAttempts);
  assert.equal(ENRICHMENT_WORKER_LIMITS.leaseMs, ENRICHMENT_ROUTE_LIMITS.leaseMs);
  assert.equal(ENRICHMENT_WORKER_LIMITS.maxJobs, 5);
  assert.equal(ENRICHMENT_WORKER_LIMITS.maxAttempts, 3);
  assert.equal(ENRICHMENT_WORKER_LIMITS.leaseMs, 10 * 60 * 1000);
});

await test("8. route gọi runEnrichmentWorker đúng contract: store + provider(key) + kết quả", async () => {
  const { deps: d, calls } = deps();
  const res = await handleEnrichmentCron(req(`Bearer ${SECRET}`), d);
  assert.equal(res.status, 200);
  assert.equal(calls.created, 1);
  assert.deepEqual(calls.providerKeys, ["jev-key-test"], "provider phải nhận JEV_API_KEY");
  assert.equal(calls.workerArgs.length, 1);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  for (const k of ["claimed", "published", "manualWins", "insufficient", "lowConfidence", "failed", "retried", "capBlocked", "planBlocked", "errors"]) {
    assert.ok(k in body, `response phải có ${k}`);
  }
});

await test("9. worker lỗi hạ tầng -> 500, không 200 giả", async () => {
  const { deps: d } = deps({ runWorker: async () => { throw new Error("db down"); } });
  const res = await handleEnrichmentCron(req(`Bearer ${SECRET}`), d);
  assert.equal(res.status, 500);
  assert.ok((await res.json()).error);
});

await test("10. GET production dùng đường thật (adminClient + provider Jev) — không env lọt ra ngoài", async () => {
  const mod = await import("@/app/api/cron/radar-enrichment/route");
  assert.equal(typeof mod.GET, "function");
  // Không set env -> phải 500 ở tầng cấu hình, tức GET KHÔNG tự bỏ qua guard.
  const saved = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    const res = await mod.GET(req(`Bearer ${SECRET}`));
    assert.equal(res.status, 500, "GET thiếu CRON_SECRET phải 500");
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
});

console.log(`\nradar-enrichment-cron-route: ${failures} fail`);
process.exitCode = failures ? 1 : 0;