// Regression: SePay webhook phải FAIL CLOSED khi chưa cấu hình auth.
// Drive the real POST handler in-process with a fetch recorder (zero network).
// Decisive assertion: cả SEPAY_WEBHOOK_SECRET và SEPAY_API_KEY đều rỗng
//   -> HTTP 500 {success:false} + log Supabase RỖNG (trên base cũ: 200 + 5 call).
// Không đụng HMAC, API-key, amount validation (Hotfix #1), idempotency, GET chẩn đoán.
//
// Chạy: node --experimental-strip-types --import ./tests/register-loader.mjs tests/sepay-webhook-fail-closed.test.ts

import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { POST } from "../app/api/sepay/webhook/route.ts";
import { NextRequest } from "next/server";
import { transferContent, quotePrice } from "../lib/payments.ts";

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

interface Call {
  method: string;
  table: string;
  url: string;
  body: string | null;
}

const TEST_SECRET = "test-secret";
const TEST_API_KEY = "test-api-key";
const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const T12_PRICE = quotePrice(12).total; // 2870000

// VAL-FC-012: log Supabase của MỌI request bị từ chối trong cả file test.
// drive()/POST trực tiếp tự nạp vào đây -> sweep không phụ thuộc assert của từng case.
const rejectedLogs: Call[][] = [];
let rejectedCases = 0;

function noteRejected(calls: Call[]) {
  rejectedCases += 1;
  rejectedLogs.push(calls);
}

// Dạng header API key hợp lệ (verifyApiKey strip prefix apikey/bearer, không phân biệt hoa thường)
type ApiKeyHeader =
  | "authorization-apikey"
  | "authorization-bearer"
  | "x-api-key"
  | "x-sepay-api-key"
  | "wrong"
  | "none";

type Mode = "hmac" | "apikey" | "none";

interface DriveOpts {
  mode?: Mode;
  /** ghi đè từng trường payload (mặc định: 1 tháng đúng giá) */
  payload?: Record<string, unknown>;
  /** thay thế body thô (dùng cho body lỗi không phải JSON) */
  rawBody?: string;
  badSig?: boolean;
  staleTs?: boolean;
  apiKeyHeader?: ApiKeyHeader;
}

const DEFAULT_PAYLOAD = () => ({
  transferType: "in",
  id: 12345,
  referenceCode: "REF-TEST",
  content: transferContent(UUID, 1),
  transferAmount: 299000,
});

interface Result {
  status: number;
  body: Record<string, unknown>;
  raw: string;
  calls: Call[];
}

/** Toàn bộ traffic Supabase đi qua globalThis.fetch, ghi lại method + table + body. */
function recorder(): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = new URL(String(input));
    const method = String(init?.method ?? "GET").toUpperCase();
    const table = url.pathname.split("/").filter(Boolean).pop() ?? "";
    calls.push({
      method,
      table,
      url: url.href,
      body: typeof init?.body === "string" ? init.body : null,
    });
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (method === "GET") {
      if (table === "payments") return json([]);
      if (table === "users") return json([]);
    }
    return json(null);
  }) as typeof fetch;
  return calls;
}

async function drive(opts: DriveOpts = {}): Promise<Result> {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "placeholder-service-role-key";
  // env auth đọc MỖI request -> mỗi case tự đặt lại
  delete process.env.SEPAY_WEBHOOK_SECRET;
  delete process.env.SEPAY_API_KEY;

  const mode = opts.mode ?? "hmac";
  const raw = opts.rawBody ?? JSON.stringify({ ...DEFAULT_PAYLOAD(), ...opts.payload });

  const headers: Record<string, string> = { "content-type": "application/json" };
  const ts = opts.staleTs ? Math.floor(Date.now() / 1000) - 600 : Math.floor(Date.now() / 1000);
  if (mode === "hmac") {
    process.env.SEPAY_WEBHOOK_SECRET = TEST_SECRET;
    const sig = opts.badSig
      ? "sha256=chu-ky-khong-hop-le"
      : `sha256=${createHmac("sha256", TEST_SECRET).update(`${ts}.${raw}`).digest("hex")}`;
    headers["x-sepay-signature"] = sig;
    headers["x-sepay-timestamp"] = String(ts);
  } else if (mode === "apikey") {
    process.env.SEPAY_API_KEY = TEST_API_KEY;
    switch (opts.apiKeyHeader ?? "authorization-apikey") {
      case "authorization-apikey":
        headers["authorization"] = `Apikey ${TEST_API_KEY}`;
        break;
      case "authorization-bearer":
        headers["authorization"] = `Bearer ${TEST_API_KEY}`;
        break;
      case "x-api-key":
        headers["x-api-key"] = TEST_API_KEY;
        break;
      case "x-sepay-api-key":
        headers["x-sepay-api-key"] = TEST_API_KEY;
        break;
      case "wrong":
        headers["authorization"] = "Apikey key-khong-dung";
        break;
      case "none":
        break;
    }
  }

  const calls = recorder();
  const res = await POST(
    new NextRequest("https://checkbds.test/api/sepay/webhook", {
      method: "POST",
      headers,
      body: raw,
    }),
  );
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const out: Result = { status: res.status, body, raw: text, calls };
  if (res.status >= 400) noteRejected(calls);
  return out;
}

/** Ghi nhận quyền lợi: PATCH/POST vào bảng users (GET đọc hạn dùng thì KHÔNG tính). */
function usersWrites(calls: Call[]): Call[] {
  return calls.filter((c) => c.table === "users" && c.method !== "GET");
}

/** Mọi ghi vào payments, kèm body đã parse. */
function paymentsWrites(calls: Call[]): { method: string; body: Record<string, unknown> }[] {
  return calls
    .filter((c) => c.table === "payments" && c.method !== "GET")
    .map((c) => ({ method: c.method, body: c.body ? JSON.parse(c.body) : {} }));
}

/** Trả về đúng status + body, và KHÔNG có request Supabase nào. */
function assertRejected(where: string, res: Result, want: number) {
  assert.equal(res.status, want, `${where}: phải trả ${want}, được ${res.status}`);
  assert.equal(res.body.success, false, `${where}: success phải false`);
  assert.equal(res.calls.length, 0, `${where}: không được có request Supabase nào`);
}

async function main() {
  console.log("\n== VAL-FC-001/002/003/004: không cấu hình auth -> 500, không ghi gì ==");

  await check("thiếu cả secret lẫn api key -> 500 success:false, ZERO call Supabase", async () => {
    // red-to-green: base cũ trả 200 + nâng gói pro + 5 call Supabase
    const res = await drive({ mode: "none" });
    assertRejected("thiếu cả hai credential", res, 500);
    assert.equal(res.body.message, "Webhook chưa được cấu hình.");
  });

  await check("thiếu cả hai credential + T12 đúng giá -> không ghi users/payments", async () => {
    const res = await drive({
      mode: "none",
      payload: { content: `NANGCAP ${UUID} T12`, transferAmount: T12_PRICE },
    });
    assert.equal(res.status, 500);
    assert.equal(usersWrites(res.calls).length, 0, "không được nâng gói");
    assert.equal(paymentsWrites(res.calls).length, 0, "không được ghi ledger");
  });

  await check("guard chạy TRƯỚC req.text(): body lỗi/thiếu content/outbound đều 500", async () => {
    const shapes: [string, DriveOpts][] = [
      ["body thiếu content", { mode: "none", payload: { content: "" } }],
      ["body không có trường content", { mode: "none", payload: {} }],
      ["transferType out", { mode: "none", payload: { transferType: "out" } }],
      ["body không phải JSON", { mode: "none", rawBody: "{khong-phai-json" }],
      ["body rỗng", { mode: "none", rawBody: "" }],
    ];
    for (const [where, opts] of shapes) {
      const res = await drive(opts);
      // chứng minh guard đứng trước JSON.parse: nếu không sẽ ra 400 "Payload không hợp lệ"
      assertRejected(`thiếu cấu hình/${where}`, res, 500);
    }
  });

  await check("thông báo 500 chung chung, không lộ credential", async () => {
    const res = await drive({ mode: "none" });
    assert.ok(!res.raw.includes(TEST_SECRET), "không được lộ giá trị secret");
    assert.ok(!res.raw.includes(TEST_API_KEY), "không được lộ giá trị api key");
    assert.ok(!res.raw.includes("SEPAY_WEBHOOK_SECRET"), "không được lộ tên biến secret");
    assert.ok(!res.raw.includes("SEPAY_API_KEY"), "không được lộ tên biến api key");
    // không lộ độ dài credential (11 và 12 ký tự) dưới dạng số đứng riêng
    assert.ok(!new RegExp(`(^|\\D)${TEST_SECRET.length}(\\D|$)`).test(res.raw), "không được lộ độ dài secret");
    assert.ok(!new RegExp(`(^|\\D)${TEST_API_KEY.length}(\\D|$)`).test(res.raw), "không được lộ độ dài api key");
    for (const v of Object.values(res.body)) {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      assert.ok(!s.includes(TEST_SECRET) && !s.includes(TEST_API_KEY), "giá trị body không được chứa credential");
      assert.notEqual(s, String(TEST_SECRET.length), "body không được là độ dài secret");
      assert.notEqual(s, String(TEST_API_KEY.length), "body không được là độ dài api key");
    }
    assert.equal(res.body.message, "Webhook chưa được cấu hình.");
  });

  console.log("\n== VAL-FC-005/006/007: đường HMAC giữ nguyên ==");

  await check("chữ ký HMAC đúng -> 200, cấp pro, ghi users đúng 1 lần", async () => {
    const res = await drive({ mode: "hmac" });
    assert.equal(res.status, 200);
    assert.equal(res.body.plan, "pro");
    assert.equal(res.body.months, 1);
    assert.equal(usersWrites(res.calls).length, 1, "phải ghi đúng 1 lần users");
    assert.equal(JSON.parse(usersWrites(res.calls)[0].body ?? "{}").plan, "pro");
  });

  await check("chữ ký HMAC sai -> 401, không ghi gì", async () => {
    const res = await drive({ mode: "hmac", badSig: true });
    assertRejected("HMAC sai", res, 401);
  });

  await check("timestamp cũ (>300s) -> 401, không ghi gì", async () => {
    const res = await drive({ mode: "hmac", staleTs: true });
    assertRejected("HMAC timestamp cũ", res, 401);
  });

  console.log("\n== VAL-FC-008/009: đường API key giữ nguyên ==");

  const headerForms: [string, ApiKeyHeader][] = [
    ["Authorization: Apikey", "authorization-apikey"],
    ["x-api-key", "x-api-key"],
    ["x-sepay-api-key", "x-sepay-api-key"],
    ["Authorization: Bearer", "authorization-bearer"],
  ];
  for (const [where, form] of headerForms) {
    await check(`API key đúng qua ${where} -> 200, ghi users 1 lần`, async () => {
      const res = await drive({ mode: "apikey", apiKeyHeader: form });
      assert.equal(res.status, 200);
      assert.equal(res.body.plan, "pro");
      assert.equal(usersWrites(res.calls).length, 1);
    });
  }

  await check("API key sai -> 401, không ghi gì", async () => {
    const res = await drive({ mode: "apikey", apiKeyHeader: "wrong" });
    assertRejected("API key sai", res, 401);
  });

  console.log("\n== VAL-FC-010: env auth đọc mỗi request ==");

  await check("đổi cấu hình giữa 2 request trong cùng một tiến trình -> đổi nhánh", async () => {
    // request 1: có secret + chữ ký đúng -> 200
    const first = await drive({ mode: "hmac" });
    assert.equal(first.status, 200, "có secret + chữ ký đúng -> 200");

    // request 2: bỏ secret, chỉ còn api key, gửi header HMAC -> 401 (nhánh api-key)
    delete process.env.SEPAY_WEBHOOK_SECRET;
    process.env.SEPAY_API_KEY = TEST_API_KEY;
    const raw = JSON.stringify(DEFAULT_PAYLOAD());
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `sha256=${createHmac("sha256", TEST_SECRET).update(`${ts}.${raw}`).digest("hex")}`;
    const calls = recorder();
    const res = await POST(
      new NextRequest("https://checkbds.test/api/sepay/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sepay-signature": sig,
          "x-sepay-timestamp": ts,
        },
        body: raw,
      }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(res.status, 401, "chỉ còn api key + gửi header HMAC -> 401");
    assert.equal(body.success, false);
    assert.equal(calls.length, 0, "không được có request Supabase nào");
    if (res.status >= 400) noteRejected(calls);
  });

  console.log("\n== VAL-FC-011: Hotfix #1 còn nguyên dưới auth hợp lệ ==");

  await check("auth hợp lệ + T12 chỉ chuyển 1000 -> unmatched, không ghi users", async () => {
    const res = await drive({
      mode: "hmac",
      payload: { content: `NANGCAP ${UUID} T12`, transferAmount: 1000 },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.unmatched, "phải trả unmatched");
    assert.equal(usersWrites(res.calls).length, 0, "không được nâng gói");
    const writes = paymentsWrites(res.calls);
    assert.equal(writes.length, 1, "chỉ được ghi đúng 1 bản ghi payments");
    assert.equal(writes[0].body.status, "unmatched");
    assert.equal(writes[0].body.plan, "unmatched");
  });

  console.log("\n== VAL-FC-012: không request bị từ chối nào ghi users/payments ==");

  await check("gộp log mọi case bị từ chối -> ZERO ghi users, ZERO ghi payments", () => {
    const aggregated = rejectedLogs.flat();
    // 5 shape thiếu cấu hình + HMAC sai + HMAC timestamp cũ + API key sai + VAL-FC-010 = 9
    assert.ok(rejectedCases >= 9, `phải thu thập >= 9 case bị từ chối, được ${rejectedCases}`);
    assert.equal(usersWrites(aggregated).length, 0, "không được ghi users");
    assert.equal(paymentsWrites(aggregated).length, 0, "không được ghi payments");
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
