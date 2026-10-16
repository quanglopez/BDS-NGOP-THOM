// Self-check: Worker production phải có NEXT_PUBLIC_SUPABASE_URL trong vars.
// Chạy: npm test

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

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

function stripJsonc(input: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

async function main() {
  const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  let config: { vars?: Record<string, unknown> } | null = null;

  await check("wrangler.jsonc parse được (JSONC)", () => {
    config = JSON.parse(stripJsonc(raw));
    assert.ok(config && typeof config === "object");
  });

  await check("vars.NEXT_PUBLIC_SUPABASE_URL đúng project bds-ngop-thom", () => {
    const url = (config?.vars ?? {}).NEXT_PUBLIC_SUPABASE_URL;
    assert.equal(url, "https://yqttttrhvriyfwcsioey.supabase.co");
  });

  await check("vars.NEXT_PUBLIC_SITE_URL không bị đổi", () => {
    const url = (config?.vars ?? {}).NEXT_PUBLIC_SITE_URL;
    assert.equal(url, "https://www.checkbds.online");
  });

  await check("không có secret nào lọt vào vars plaintext", () => {
    const vars = config?.vars ?? {};
    for (const key of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "JEV_API_KEY",
      "OPENROUTER_API_KEY",
      "SEPAY_API_KEY",
      "SEPAY_WEBHOOK_SECRET",
      "CRON_SECRET",
    ]) {
      assert.equal(key in vars, false, `${key} không được nằm trong vars`);
    }
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
