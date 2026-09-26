// Self-check: redirect sau login luôn về domain thật. Chạy: npm test
import { strict as assert } from "node:assert";
import { siteOrigin, safeNextPath } from "../lib/site-url.ts";

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass += 1;
      console.log(`  ok  ${name}`);
    })
    .catch((e: Error) => {
      fail += 1;
      console.log(`FAIL  ${name}\n      ${e.message}`);
    });
}

async function main() {
  const OLD = "https://check-bds-ngop-quangs-projects-cc2709cd.vercel.app";
  const CANON = "https://www.checkbds.online";

  console.log("\n== siteOrigin (đưa về domain thật) ==");

  await check("rớt về URL Vercel -> đưa về domain thật", () => {
    process.env.NEXT_PUBLIC_SITE_URL = CANON;
    assert.equal(siteOrigin(OLD), CANON);
    assert.equal(siteOrigin("https://check-bds-ngop.vercel.app"), CANON);
  });

  await check("đang ở domain thật -> giữ nguyên", () => {
    process.env.NEXT_PUBLIC_SITE_URL = CANON;
    assert.equal(siteOrigin(CANON), CANON);
    assert.equal(siteOrigin("https://checkbds.online"), CANON);
  });

  await check("localhost dev -> giữ nguyên, không nhảy sang production", () => {
    process.env.NEXT_PUBLIC_SITE_URL = CANON;
    assert.equal(siteOrigin("http://localhost:3000"), "http://localhost:3000");
    assert.equal(siteOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  });

  await check("không set env -> dùng origin của request", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    assert.equal(siteOrigin(CANON), CANON);
    assert.equal(siteOrigin(OLD), OLD);
  });

  console.log("\n== safeNextPath (chặn open redirect) ==");

  await check("path nội bộ hợp lệ thì giữ", () => {
    assert.equal(safeNextPath("/dashboard"), "/dashboard");
    assert.equal(safeNextPath("/dashboard?tab=category"), "/dashboard?tab=category");
    assert.equal(safeNextPath("/admin"), "/admin");
  });

  await check("URL tuyệt đối / //evil.com bị đá về dashboard", () => {
    assert.equal(safeNextPath("https://evil.com"), "/dashboard");
    assert.equal(safeNextPath("//evil.com"), "/dashboard");
    assert.equal(safeNextPath("/\\evil.com"), "/dashboard");
    assert.equal(safeNextPath("javascript:alert(1)"), "/dashboard");
    assert.equal(safeNextPath(null), "/dashboard");
    assert.equal(safeNextPath(""), "/dashboard");
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
