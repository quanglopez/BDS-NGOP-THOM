// Regression: log lỗi scan radar KHÔNG được mất PostgREST error object.
// Trước fix: `e instanceof Error ? e.message : String(e)` -> "[object Object]".
import { strict as assert } from "node:assert";
import { describeScanError } from "../lib/radar/scan-error.ts";

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

console.log("\n== PostgREST error capture ==");

check("plain PostgREST object KHÔNG còn [object Object]", () => {
  const pgErr = {
    code: "42P01",
    message: 'relation "market_price_stats" does not exist',
    details: null,
    hint: null,
  };
  const out = describeScanError(pgErr);
  assert.ok(!out.includes("[object Object]"), `phải log được nội dung: ${out}`);
  assert.ok(out.includes("42P01"), `phải giữ code: ${out}`);
  assert.ok(out.includes("market_price_stats"), `phải giữ message: ${out}`);
});


check("Error thật vẫn giữ name + message + stack", () => {
  const err = new TypeError("boom");
  const out = describeScanError(err);
  assert.ok(out.includes("TypeError"), out);
  assert.ok(out.includes("boom"), out);
  assert.ok(out.includes("stack") && /at |file:\/\//.test(out), `phải giữ stack: ${out}`);
});

check("không rò rỉ secret / token / cookie / authorization / body", () => {
  const leaky = {
    code: "PGRST301",
    message: "jwt eyJhbGciOiJIUzI1NiJ9abcdefgh token leaked",
    hint: "api_key=sk-live-abcdefgh12345",
    // Các field nhạy cảm phải bị bỏ, kể cả khi có mặt trong object:
    authorization: "Bearer secret-token-value",
    cookie: "sb-access-token=xyz",
    headers: { authorization: "Bearer secret-token-value" },
    body: { original_text: "noi dung tin rao cua khach" },
  };
  const out = describeScanError(leaky);
  assert.ok(!out.includes("[object Object]"), out);
  assert.ok(!out.includes("secret-token-value"), `không rò token: ${out}`);
  assert.ok(!out.includes("sk-live-abcdefgh12345"), `không rò api key: ${out}`);
  assert.ok(!out.includes("sb-access-token"), `không rò cookie: ${out}`);
  assert.ok(!out.includes("noi dung tin rao cua khach"), `không rò body: ${out}`);
  assert.ok(!/authorization|cookie|headers|body/i.test(out), `không được log cả khoá nhạy cảm: ${out}`);
});

check("không stringify object rỗng / chỉ field nhạy cảm", () => {
  const out = describeScanError({ authorization: "Bearer abc", cookie: "x=y" });
  assert.equal(out, "unknown_error");
});

check("giá trị không phải Error / không phải object vẫn đọc được", () => {
  assert.equal(describeScanError("fetch failed"), "fetch failed");
  assert.equal(describeScanError(undefined), "unknown_error");
  assert.equal(describeScanError(null), "unknown_error");
});

check("log dài bị cắt bớt để không phình log", () => {
  const out = describeScanError({ message: "x".repeat(1000) });
  assert.ok(out.length < 400, `log phải ngắn: ${out.length}`);
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;