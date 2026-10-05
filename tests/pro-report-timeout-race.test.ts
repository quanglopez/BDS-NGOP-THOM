// Regression: timeout 20s phải thắng — late response KHÔNG được ghi đè
// failed state về ready. Mirror đúng flow trong components/report/pro-report.tsx.
import { strict as assert } from "node:assert";

type State = "loading" | "ready" | "failed";

function runProAnalysisFlow(opts: {
  fetchImpl: () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  timeoutMs: number;
  events: string[];
}): Promise<{ state: State; retrySupported: boolean }> {
  // Copy-paste cấu trúc effect trong pro-report.tsx, thay setState bằng biến cục bộ.
  return new Promise((resolve) => {
    let cancelled = false;
    let timedOut = false;
    let state: State = "loading";
    let retrySupported = false;
    const done = () => resolve({ state, retrySupported });
    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      timedOut = true;
      opts.events.push("pro_analysis_timeout");
      state = "failed";
      retrySupported = true;
      setTimeout(done, opts.timeoutMs * 3); // chờ late response rồi mới chốt
    }, opts.timeoutMs);
    (async () => {
      try {
        const res = await opts.fetchImpl();
        const json = await res.json().catch(() => null);
        if (cancelled || timedOut) return;
        clearTimeout(timeoutId);
        if (!res.ok) {
          state = "failed";
          retrySupported = res.status >= 500;
          done();
          return;
        }
        state = "ready";
        done();
      } catch {
        clearTimeout(timeoutId);
        if (!cancelled && !timedOut) {
          state = "failed";
          retrySupported = true;
        }
        done();
      }
    })();
  });
}

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass += 1;
      console.log(`  ok  ${name}`);
    })
    .catch((e) => {
      fail += 1;
      console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
    });
}

console.log("\n== Pro Analysis timeout race ==");

await check("timeout rồi late success KHÔNG về ready", async () => {
  const events: string[] = [];
  const result = await runProAnalysisFlow({
    events,
    timeoutMs: 20,
    fetchImpl: () =>
      new Promise((r) =>
        setTimeout(() => r({ ok: true, status: 200, json: async () => ({ analysis: {} }) }), 60),
      ),
  });
  assert.equal(result.state, "failed");
  assert.equal(result.retrySupported, true);
  assert.deepEqual(events, ["pro_analysis_timeout"]);
});

await check("success trước timeout vẫn ready", async () => {
  const events: string[] = [];
  const result = await runProAnalysisFlow({
    events,
    timeoutMs: 200,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ analysis: {} }) }),
  });
  assert.equal(result.state, "ready");
  assert.deepEqual(events, []);
});

await check("error trước timeout vẫn failed + retry", async () => {
  const events: string[] = [];
  const result = await runProAnalysisFlow({
    events,
    timeoutMs: 200,
    fetchImpl: async () => {
      throw new Error("network");
    },
  });
  assert.equal(result.state, "failed");
  assert.equal(result.retrySupported, true);
  assert.deepEqual(events, []);
});

await check("error sau timeout KHÔNG ghi đè failed", async () => {
  const events: string[] = [];
  const result = await runProAnalysisFlow({
    events,
    timeoutMs: 20,
    fetchImpl: () => new Promise((_, rej) => setTimeout(() => rej(new Error("late")), 60)),
  });
  assert.equal(result.state, "failed");
  assert.equal(result.retrySupported, true);
  assert.deepEqual(events, ["pro_analysis_timeout"]);
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
