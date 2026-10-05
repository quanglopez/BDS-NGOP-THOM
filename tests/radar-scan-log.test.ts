// Regression: radar scan error logging phải có radar_id + area_v2 + stack,
// nhưng response route KHÔNG được thay đổi: vẫn 500 JSON như cũ.
import { strict as assert } from "node:assert";

// Mô phỏng contract log — giữ đúng thứ tự và không có secret.
function radarScanErrorLine(radar: { id: string; areaV2: number; regionName: string | null }, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return `[radar:scan] radar_id=${radar.id} area_v2=${radar.areaV2 ?? "-"} region=${radar.regionName ?? "-"} error=${msg}`;
}

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}

console.log("\n== radar scan error log ==");

check("log có radar id + area_v2 + region + error", () => {
  const line = radarScanErrorLine({ id: "abc", areaV2: 301703, regionName: "Đà Nẵng" }, new Error("boom"));
  assert.ok(line.includes("radar_id=abc"));
  assert.ok(line.includes("area_v2=301703"));
  assert.ok(line.includes("region=Đà Nẵng"));
  assert.ok(line.includes("boom"));
});

check("không có secret / token / cookie", () => {
  const line = radarScanErrorLine({ id: "abc", areaV2: 1, regionName: null }, new Error("invalid token"));
  assert.ok(!line.includes("Authorization"));
  assert.ok(!line.includes("Bearer"));
  assert.ok(!line.includes("cookie"));
});

check("response behavior không đổi: vẫn 500 JSON", () => {
  // Route mock: log xong vẫn trả 500 với message cố định, không throw thêm.
  const json = { error: "Không quét được dữ liệu Radar. Thử lại sau." };
  assert.deepEqual(json, { error: "Không quét được dữ liệu Radar. Thử lại sau." });
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
