// Self-check: runCheck xử lý đúng 401 (chưa đăng nhập) và 429 (hết lượt).
// Chạy: npm test
import { strict as assert } from "node:assert";
import { runCheck } from "../lib/client-check.ts";

const SAMPLE =
  "Bán gấp! Nhà mặt tiền Thùy Vân 80m2, ngân hàng thanh lý, giá 5.5 tỷ, sổ hồng riêng, hẻm xe hơi";

let pass = 0;
let fail = 0;
const realFetch = globalThis.fetch;

async function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass += 1;
      console.log(`  ok  ${name}`);
    })
    .catch((e: Error) => {
      fail += 1;
      console.log(`FAIL  ${name}\n      ${e.message}`);
    })
    .finally(() => {
      globalThis.fetch = realFetch;
    });
}

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

async function main() {
  console.log("\n== runCheck: chưa đăng nhập (401) ==");

  await check("401 -> bản xem trước, KHÔNG phải hết lượt", async () => {
    mockFetch(401, { error: "Cần đăng nhập" });
    const r = await runCheck(SAMPLE);
    assert.equal(r.authRequired, true, "phải báo authRequired");
    assert.equal(r.quotaExhausted, undefined, "401 không phải hết lượt");
    assert.ok(r.result.overall > 0, "vẫn trả kết quả dự phòng cho xem trước");
  });

  console.log("\n== runCheck: hết lượt (429) ==");

  await check("429 -> báo hết lượt + giữ thông báo server", async () => {
    mockFetch(429, { error: "Hết 20 lượt check/ngày của gói free. Nâng cấp Pro để check thêm." });
    const r = await runCheck(SAMPLE);
    assert.equal(r.quotaExhausted, true, "phải báo quotaExhausted");
    assert.equal(r.authRequired, undefined, "429 không phải chưa đăng nhập");
    assert.match(String(r.serverError), /Hết 20 lượt/, "phải giữ nguyên thông báo server");
  });

  await check("429 không gắn nhãn 'bản xem trước'", async () => {
    mockFetch(429, { error: "Hết lượt" });
    const r = await runCheck(SAMPLE);
    assert.notEqual(r.source, "ai");
    assert.equal(r.authRequired, undefined);
  });

  console.log("\n== runCheck: lỗi khác (500) ==");

  await check("500 -> coi như lỗi tạm thời, không báo hết lượt", async () => {
    mockFetch(500, { error: "Lỗi máy chủ" });
    const r = await runCheck(SAMPLE);
    assert.equal(r.quotaExhausted, undefined, "500 không phải hết lượt");
    assert.equal(r.authRequired, undefined);
    assert.ok(r.result.overall > 0, "vẫn có kết quả dự phòng");
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  // process.exit() huy async handle -> libuv assertion tren Windows.
  // process.exitCode de tien trinh tu thoat, chay lai 100%
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
