// Self-check: cron route /api/cron/radar-scan.
// Import handler THẬT (handleRadarScanCron), override dependency: không chạm DB,
// không gọi AI. Chứng minh kill switch / cost guard chặn TRƯỚC mọi scan work.
import assert from "node:assert/strict";
import { handleRadarScanCron, type RadarScanCronDeps } from "@/lib/radar/scan-cron";

const SECRET = "cron-secret-test-1234567890";
const ENV_OK: Record<string, string | undefined> = { CRON_SECRET: SECRET };

interface Calls {
  db: number;
  list: number;
  scan: string[];
}

function deps(over: { env?: Record<string, string | undefined> } = {}): { deps: RadarScanCronDeps; calls: Calls } {
  const calls: Calls = { db: 0, list: 0, scan: [] };
  return {
    calls,
    deps: {
      env: over.env ?? ENV_OK,
      createDb: () => {
        calls.db++;
        return {} as never;
      },
      listActiveRadars: async () => {
        calls.list++;
        return [
          { id: "r1", name: "A", coverage: { checkedAt: null } },
          { id: "r2", name: "B", coverage: { checkedAt: null } },
        ] as never;
      },
      scanRadar: async (_db, radar) => {
        calls.scan.push(radar.id);
        return { newMatchCount: 0 } as never;
      },
      sleep: async () => undefined,
      markScanFailed: async () => undefined,
    },
  };
}

const req = (auth?: string) =>
  new Request("https://app.example/api/cron/radar-scan", {
    headers: auth === undefined ? {} : { authorization: auth },
  });

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

// ---------------------------------------------------------------- guards

await test("A. kill switch = 1 -> 200 skipped kill_switch, ZERO scan/store work", async () => {
  const { deps: d, calls } = deps({ env: { ...ENV_OK, AUTO_ENRICHMENT_KILL_SWITCH: "1" } });
  const res = await handleRadarScanCron(req(`Bearer ${SECRET}`), d);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.skipped, "kill_switch");
  assert.equal(calls.db, 0, "không được tạo DB client");
  assert.equal(calls.list, 0, "không được list radar");
  assert.equal(calls.scan.length, 0, "không được scan radar");
});

await test("B. cost guard = 1 -> 200 skipped cost_guard, ZERO scan/store work", async () => {
  const { deps: d, calls } = deps({ env: { ...ENV_OK, AUTO_ENRICHMENT_COST_GUARD: "1" } });
  const res = await handleRadarScanCron(req(`Bearer ${SECRET}`), d);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.skipped, "cost_guard");
  assert.equal(calls.db, 0);
  assert.equal(calls.list, 0);
  assert.equal(calls.scan.length, 0);
});

// ---------------------------------------------------------------- normal path

await test("C. cả hai guard unset -> hành vi bình thường (list + scan chạy)", async () => {
  const { deps: d, calls } = deps();
  const res = await handleRadarScanCron(req(`Bearer ${SECRET}`), d);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(calls.db, 1);
  assert.equal(calls.list, 1);
  assert.deepEqual(calls.scan, ["r1", "r2"]);
});

await test("C2. guard = 0 không kích hoạt (chỉ giá trị '1' mới chặn)", async () => {
  const { deps: d, calls } = deps({
    env: { ...ENV_OK, AUTO_ENRICHMENT_KILL_SWITCH: "0", AUTO_ENRICHMENT_COST_GUARD: "0" },
  });
  const res = await handleRadarScanCron(req(`Bearer ${SECRET}`), d);
  assert.equal(res.status, 200);
  assert.equal(calls.list, 1);
  assert.equal(calls.scan.length, 2);
});

// ---------------------------------------------------------------- auth

await test("D. bad bearer -> 401 TRƯỚC mọi work", async () => {
  const { deps: d, calls } = deps();
  const res = await handleRadarScanCron(req("Bearer wrong-secret-value-000000"), d);
  assert.equal(res.status, 401);
  assert.equal(calls.db, 0);
  assert.equal(calls.list, 0);
  assert.equal(calls.scan.length, 0);
});

await test("D2. thiếu Authorization -> 401, không work", async () => {
  const { deps: d, calls } = deps();
  const res = await handleRadarScanCron(req(), d);
  assert.equal(res.status, 401);
  assert.equal(calls.list, 0);
});

await test("D3. bad bearer + kill switch -> vẫn 401 (auth trước guard, không lộ trạng thái)", async () => {
  const { deps: d, calls } = deps({ env: { ...ENV_OK, AUTO_ENRICHMENT_KILL_SWITCH: "1" } });
  const res = await handleRadarScanCron(req("Bearer nope"), d);
  assert.equal(res.status, 401);
  assert.equal(calls.db, 0);
});

// ---------------------------------------------------------------- fail-closed

await test("E. CRON_SECRET thiếu -> 500, không work", async () => {
  const { deps: d, calls } = deps({ env: {} });
  const res = await handleRadarScanCron(req(`Bearer ${SECRET}`), d);
  assert.equal(res.status, 500);
  assert.equal(calls.db, 0);
  assert.equal(calls.list, 0);
});



await test("F. scan lỗi 1 radar -> failed++, ghi last_scan_error, tiếp tục radar khác", async () => {
  const marks: string[] = [];
  const { deps: d } = deps();
  d.scanRadar = async (_db, radar) => {
    if (radar.id === "r1") throw new Error("boom");
    return { newMatchCount: 0 };
  };
  d.markScanFailed = async (_db, radarId) => { marks.push(radarId); };
  const res = await handleRadarScanCron(req(`Bearer ${SECRET}`), d);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { failed: number; scanned: number; errors: { id: string }[] };
  assert.equal(body.failed, 1);
  assert.equal(body.scanned, 1);
  assert.equal(body.errors[0].id, "r1");
  assert.deepEqual(marks, ["r1"], "phải ghi last_scan_error cho radar lỗi");
});
console.log(`\nradar-scan-cron-route: ${failures} fail`);
process.exitCode = failures ? 1 : 0;


