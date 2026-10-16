// Self-check: Cloudflare scheduled wrapper (Stage 2 PR-1 — capability only).
//
// Chứng minh:
// - dispatch: cron → đúng job, cron lạ = no-op an toàn
// - scheduled gọi logic NỘI BỘ, KHÔNG cần CRON_SECRET (khác HTTP route)
// - HTTP route vẫn bắt buộc Bearer CRON_SECRET
// - kill switch / cost guard còn hiệu lực trên ĐƯỜNG SCHEDULED
// - binding text được đồng bộ vào process.env cho scheduled
// - entry re-export đủ DO class + uỷ quyền fetch, và KHÔNG self-fetch
//
// Không chạm DB, không gọi AI: runner là stub, deps được override.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CRON_RADAR_ENRICHMENT,
  CRON_RADAR_SCAN,
  jobForCron,
  textEnv,
  hydrateProcessEnv,
  runScheduledCron,
} from "@/lib/radar/cron-dispatch";
import { runEnrichmentJob, handleEnrichmentCron, type EnrichmentCronDeps } from "@/lib/radar/enrichment-cron";
import { runRadarScanJob, handleRadarScanCron, type RadarScanCronDeps } from "@/lib/radar/scan-cron";
import { runEnrichmentWorker, type EnrichmentWorkerStore } from "@/lib/radar/enrichment-worker";

const SECRET = "cron-secret-test-1234567890";

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

const ENTRY = readFileSync(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
const DISPATCH_SRC = readFileSync(new URL("../lib/radar/cron-dispatch.ts", import.meta.url), "utf8");
const JOBS_SRC = readFileSync(new URL("../lib/radar/cron-jobs.ts", import.meta.url), "utf8");
const WRANGLER = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

// ------------------------------------------------------------- 1. dispatch

await test("1. cron khớp → đúng job; mỗi cron chỉ chạy runner của nó", async () => {
  const calls: string[] = [];
  const runners = {
    enrichment: async () => {
      calls.push("enrichment");
      return new Response("{}", { status: 200 });
    },
    scan: async () => {
      calls.push("scan");
      return new Response("{}", { status: 200 });
    },
  };

  const a = await runScheduledCron({ cron: CRON_RADAR_ENRICHMENT, runners });
  assert.equal(a.job, "radar-enrichment");
  assert.equal(a.ran, true);
  assert.equal(a.status, 200);

  const b = await runScheduledCron({ cron: CRON_RADAR_SCAN, runners });
  assert.equal(b.job, "radar-scan");
  assert.deepEqual(calls, ["enrichment", "scan"], "mỗi cron chỉ được chạy runner của nó");
});

await test("2. cron lạ → no-op an toàn, KHÔNG chạy job nào, không ném", async () => {
  const calls: string[] = [];
  const runners = {
    enrichment: async () => {
      calls.push("enrichment");
      return new Response("{}");
    },
    scan: async () => {
      calls.push("scan");
      return new Response("{}");
    },
  };
  for (const cron of ["", "0 0 * * *", "*/5 * * * * ", "*/10 * * * *", "7 3 * * *  "]) {
    const out = await runScheduledCron({ cron, runners });
    assert.equal(out.job, null, `cron lạ phải là null: ${JSON.stringify(cron)}`);
    assert.equal(out.ran, false);
    assert.equal(out.ok, true);
  }
  assert.deepEqual(calls, [], "cron lạ không được chạy job nào");
});

await test("2b. cron khớp CHÍNH XÁC kể cả khoảng trắng (Cloudflare so từng ký tự)", () => {
  assert.equal(jobForCron("*/5 * * * *"), "radar-enrichment");
  assert.equal(jobForCron("7 3 * * *"), "radar-scan");
  assert.equal(jobForCron(" */5 * * * *"), null);
  assert.equal(jobForCron("*/5  * * * *"), null);
});

await test("3. runner lỗi → không ném ra ngoài, báo ok:false (cron không sập Worker)", async () => {
  const out = await runScheduledCron({
    cron: CRON_RADAR_SCAN,
    runners: {
      enrichment: async () => new Response("{}"),
      scan: async () => {
        throw new Error("boom");
      },
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "Error");
});

await test("3b. response 500 từ runner → ok:false nhưng vẫn tính là đã chạy", async () => {
  const out = await runScheduledCron({
    cron: CRON_RADAR_ENRICHMENT,
    runners: {
      enrichment: async () => new Response(JSON.stringify({ error: "x" }), { status: 500 }),
      scan: async () => new Response("{}"),
    },
  });
  assert.equal(out.ran, true);
  assert.equal(out.status, 500);
  assert.equal(out.ok, false);
});

// ------------------------------------------------- 4. env sync cho scheduled

await test("4. textEnv chỉ lấy binding text, bỏ binding object (ASSETS/IMAGES)", () => {
  const env = textEnv({
    CRON_SECRET: "s",
    NEXT_PUBLIC_SITE_URL: "https://x",
    ASSETS: { fetch: () => {} },
    IMAGES: { input: () => {} },
    NUM: 42,
  });
  assert.deepEqual(Object.keys(env).sort(), ["CRON_SECRET", "NEXT_PUBLIC_SITE_URL"]);
});

await test("5. hydrateProcessEnv đồng bộ secret vào process.env cho scheduled path", () => {
  const key = "CBDS_TEST_HYDRATE_KEY";
  delete process.env[key];
  hydrateProcessEnv({ [key]: "value-1" });
  assert.equal(process.env[key], "value-1");
  delete process.env[key];
});

// ------------------------------------- 6. scheduled KHÔNG cần CRON_SECRET

/** Store rỗng: chứng minh đường scheduled chạy được mà không cần secret. */
function stubStore(): EnrichmentWorkerStore {
  const noop = async () => undefined;
  return {
    reclaimStaleProcessing: async () => ({ requeued: 0, failed: 0 }),
    claimPending: async () => [],
    isPlanPro: async () => true,
    beginDispatch: async () => "2026-10-03T00:00:00.000Z",
    markMatchProcessing: async () => true,
    releaseToPending: noop,
    markTerminal: async () => true,
    latestManualCheckAt: async () => null,
    persistMatchEnrichment: async () => true,
  } as unknown as EnrichmentWorkerStore;
}

function enrichmentDeps(env: Record<string, string | undefined>): { deps: EnrichmentCronDeps; calls: { created: number } } {
  const calls = { created: 0 };
  return {
    calls,
    deps: {
      env,
      createStore: () => {
        calls.created++;
        return stubStore();
      },
      createProvider: () => async () => ({ kind: "insufficient_data" }),
      runWorker: runEnrichmentWorker,
    },
  };
}

function scanDeps(env: Record<string, string | undefined>) {
  const calls = { db: 0, list: 0, scan: [] as string[] };
  return {
    calls,
    deps: {
      env,
      createDb: () => {
        calls.db++;
        return {} as never;
      },
      listActiveRadars: async () => {
        calls.list++;
        return [{ id: "r1", name: "A", coverage: { checkedAt: null } }] as never;
      },
      scanRadar: async (_db: unknown, radar: { id: string }) => {
        calls.scan.push(radar.id);
        return { newMatchCount: 0 } as never;
      },
      sleep: async () => undefined,
      markScanFailed: async () => undefined,
    } as RadarScanCronDeps,
  };
}

await test("6. runEnrichmentJob chạy với env KHÔNG có CRON_SECRET (scheduled nội bộ)", async () => {
  const { deps, calls } = enrichmentDeps({ JEV_API_KEY: "jev-key-test" });
  const res = await runEnrichmentJob(deps);
  assert.equal(res.status, 200);
  assert.equal(calls.created, 1, "phải tạo store và chạy worker");
});

await test("7. runRadarScanJob chạy với env KHÔNG có CRON_SECRET (scheduled nội bộ)", async () => {
  const { deps, calls } = scanDeps({});
  const res = await runRadarScanJob(deps);
  assert.equal(res.status, 200);
  assert.equal(calls.list, 1);
  assert.deepEqual(calls.scan, ["r1"]);
});

// ------------------------------- 8. HTTP route VẪN bắt buộc Bearer secret

await test("8. HTTP enrichment vẫn 401 khi thiếu/sai Bearer (auth không bị nới)", async () => {
  const noAuth = enrichmentDeps({ CRON_SECRET: SECRET, JEV_API_KEY: "k" });
  const bad = enrichmentDeps({ CRON_SECRET: SECRET, JEV_API_KEY: "k" });
  const req = (auth?: string) =>
    new Request("https://app.example/api/cron/radar-enrichment", {
      headers: auth === undefined ? {} : { authorization: auth },
    });

  assert.equal((await handleEnrichmentCron(req(), noAuth.deps)).status, 401);
  assert.equal(noAuth.calls.created, 0, "401 phải chặn TRƯỚC khi tạo store");
  assert.equal((await handleEnrichmentCron(req("Bearer wrong-secret-000000000"), bad.deps)).status, 401);
  assert.equal(bad.calls.created, 0);
});

await test("9. HTTP scan vẫn 401 khi thiếu/sai Bearer (auth không bị nới)", async () => {
  const noAuth = scanDeps({ CRON_SECRET: SECRET });
  const bad = scanDeps({ CRON_SECRET: SECRET });
  const req = (auth?: string) =>
    new Request("https://app.example/api/cron/radar-scan", {
      headers: auth === undefined ? {} : { authorization: auth },
    });

  assert.equal((await handleRadarScanCron(req(), noAuth.deps)).status, 401);
  assert.equal(noAuth.calls.list, 0);
  assert.equal((await handleRadarScanCron(req("Bearer wrong-secret-000000000"), bad.deps)).status, 401);
  assert.equal(bad.calls.list, 0);
});

await test("10. HTTP route thiếu CRON_SECRET → 500, không work (fail closed)", async () => {
  const e = enrichmentDeps({ JEV_API_KEY: "k" });
  const s = scanDeps({});
  const req = (p: string) => new Request(`https://app.example${p}`, { headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal((await handleEnrichmentCron(req("/api/cron/radar-enrichment"), e.deps)).status, 500);
  assert.equal(e.calls.created, 0);
  assert.equal((await handleRadarScanCron(req("/api/cron/radar-scan"), s.deps)).status, 500);
  assert.equal(s.calls.list, 0);
});

// ------------------------------------- 11. guard còn hiệu lực trên scheduled

await test("11. scheduled enrichment: kill switch / cost guard dừng TRƯỚC claim", async () => {
  for (const [env, skipped] of [
    [{ JEV_API_KEY: "k", AUTO_ENRICHMENT_KILL_SWITCH: "1" }, "kill_switch"],
    [{ JEV_API_KEY: "k", AUTO_ENRICHMENT_COST_GUARD: "1" }, "cost_guard"],
  ] as const) {
    const { deps, calls } = enrichmentDeps(env as Record<string, string | undefined>);
    const res = await runEnrichmentJob(deps);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as Record<string, unknown>).skipped, skipped);
    assert.equal(calls.created, 0, `${skipped} phải dừng trước khi tạo store/claim`);
  }
});

await test("12. scheduled scan: kill switch / cost guard dừng TRƯỚC mọi work", async () => {
  for (const env of [{ AUTO_ENRICHMENT_KILL_SWITCH: "1" }, { AUTO_ENRICHMENT_COST_GUARD: "1" }]) {
    const { deps, calls } = scanDeps(env);
    const res = await runRadarScanJob(deps);
    assert.equal(res.status, 200);
    assert.equal(calls.db, 0, "không được tạo DB client");
    assert.equal(calls.list, 0, "không được list radar");
    assert.equal(calls.scan.length, 0, "không được scan");
  }
});

await test("13. scheduled enrichment thiếu JEV_API_KEY → 500, không claim (không tiêu allowance)", async () => {
  const { deps, calls } = enrichmentDeps({});
  const res = await runEnrichmentJob(deps);
  assert.equal(res.status, 500);
  assert.equal(calls.created, 0);
});

// ------------------------------------------- 14. entry: uỷ quyền + no self-fetch

await test("14. entry re-export đủ 3 Durable Object class của OpenNext", () => {
  for (const name of ["DOQueueHandler", "DOShardedTagCache", "BucketCachePurge"]) {
    assert.ok(
      new RegExp(`export\\s*\\{[^}]*${name}`).test(ENTRY),
      `entry phải re-export ${name}`,
    );
  }
});

await test("15. entry uỷ quyền fetch NGUYÊN VẸN cho OpenNext (không bọc lại)", () => {
  assert.ok(/fetch:\s*openNextWorker\.fetch/.test(ENTRY), "fetch phải trỏ thẳng vào worker OpenNext");
  assert.ok(!/async\s+fetch\s*\(/.test(ENTRY), "entry không được tự định nghĩa lại fetch");
});

await test("16. entry export scheduled(controller, env, ctx)", () => {
  assert.ok(/async\s+scheduled\s*\(/.test(ENTRY), "phải có scheduled handler");
  assert.ok(/controller\.cron/.test(ENTRY), "scheduled phải dispatch theo controller.cron");
});

await test("17. KHÔNG self-fetch HTTP route (cùng zone = lỗi 1042 + vòng lặp)", () => {
  // Bỏ comment trước khi soi: comment có thể NHẮC tới route (giải thích), nhưng
  // code thật thì không được gọi. Chỉ kiểm code.
  const codeOf = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const [name, src] of [
    ["cloudflare/worker.ts", ENTRY],
    ["lib/radar/cron-dispatch.ts", DISPATCH_SRC],
    ["lib/radar/cron-jobs.ts", JOBS_SRC],
  ] as const) {
    const code = codeOf(src);
    assert.ok(!/checkbds\.online/.test(code), `${name} không được gọi domain production`);
    assert.ok(!/\bfetch\s*\(/.test(code), `${name} không được gọi fetch()`);
    assert.ok(!/\/api\/cron/.test(code), `${name} không được gọi HTTP cron route`);
  }
});

// ---------------------------------------------- 18. config: chưa bật trigger

await test("18. wrangler chưa khai báo triggers.crons (capability only)", () => {
  const parsed = JSON.parse(
    WRANGLER.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""),
  ) as Record<string, unknown>;
  assert.equal(parsed.triggers, undefined, "PR-1 KHÔNG được thêm triggers.crons");
  assert.equal(parsed.main, "cloudflare/worker.ts", "main phải trỏ entry tự viết");
});

await test("19. wrangler giữ nguyên route production + không nhét secret vào vars", () => {
  const parsed = JSON.parse(
    WRANGLER.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""),
  ) as { routes?: { pattern: string; custom_domain?: boolean }[]; vars?: Record<string, string> };
  assert.deepEqual(parsed.routes, [{ pattern: "www.checkbds.online", custom_domain: true }]);
  assert.deepEqual(Object.keys(parsed.vars ?? {}), ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
});

console.log(`\nscheduled-wrapper: ${failures} fail`);
process.exitCode = failures ? 1 : 0;
