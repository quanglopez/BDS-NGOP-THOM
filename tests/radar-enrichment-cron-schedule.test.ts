// Khóa config cron Radar Enrichment: chạy mỗi 5 phút, không duplicate,
// worker contract (maxJobs=5) giữ nguyên. Không mock production.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ENRICHMENT_WORKER_LIMITS } from "@/lib/radar/enrichment-worker";

const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
  crons: Array<{ path: string; schedule: string }>;
};

let failures = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ok  ${name}`); } catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
}

test("1. có đúng 1 cron cho /api/cron/radar-enrichment", () => {
  const matches = vercel.crons.filter((c) => c.path === "/api/cron/radar-enrichment");
  assert.equal(matches.length, 1);
});

test("2. radar-enrichment chạy mỗi 5 phút", () => {
  const job = vercel.crons.find((c) => c.path === "/api/cron/radar-enrichment");
  assert.equal(job?.schedule, "*/5 * * * *");
});

test("3. radar-scan cron vẫn tồn tại và schedule giữ nguyên", () => {
  const job = vercel.crons.find((c) => c.path === "/api/cron/radar-scan");
  assert.equal(job?.schedule, "7 3 * * *");
});

test("4. không duplicate path nào", () => {
  const paths = vercel.crons.map((c) => c.path);
  assert.equal(paths.length, paths.filter((p, i) => paths.indexOf(p) === i).length);
});

test("5. worker maxJobs vẫn = 5", () => {
  assert.equal(ENRICHMENT_WORKER_LIMITS.maxJobs, 5);
});

if (failures > 0) { console.error(`${failures} failed`); process.exit(1); }
console.log("ok");
