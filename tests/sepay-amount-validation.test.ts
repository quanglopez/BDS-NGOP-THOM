// Regression: SePay webhook không được nâng gói khi tiền không khớp gói/số tháng.
// Drive the real POST handler in-process with a fetch recorder.
// Decisive assertion: every rejection issues ZERO PATCH/POST to the users table.
// Multi-month grants only for tiers in DURATIONS (2,3,6,12) with amount >= quotePrice(months).total.
//
// Chạy: node --experimental-strip-types --import ./tests/register-loader.mjs tests/sepay-amount-validation.test.ts

import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { POST } from "../app/api/sepay/webhook/route.ts";
import { NextRequest } from "next/server";
import { transferContent, quotePrice, DURATIONS } from "../lib/payments.ts";

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

interface RecorderOpts {
  /** trả về bản ghi paid cho sepay_ref -> short-circuit idempotent */
  existingPaidRef?: boolean;
  /** trả về bản ghi pending -> update thay vì insert */
  pendingRow?: boolean;
  /** plan_expires_at hiện tại của user */
  userExpiry?: string | null;
}

const TEST_SECRET = "test-secret";
const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

function setupEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "placeholder-service-role-key";
  process.env.SEPAY_WEBHOOK_SECRET = TEST_SECRET;
}

/** Toàn bộ traffic Supabase đi qua globalThis.fetch, ghi lại method + table + body. */
function recorder(options: RecorderOpts = {}): Call[] {
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
      if (table === "payments") {
        // PostgREST filter: status=eq.paid (không phải "paid")
        const status = url.searchParams.get("status") ?? "";
        if (status === "eq.paid" && options.existingPaidRef) return json([{ id: 1 }]);
        if (status === "eq.pending" && options.pendingRow) return json([{ id: 7 }]);
        return json([]);
      }
      if (table === "users") {
        return json(options.userExpiry ? [{ plan_expires_at: options.userExpiry }] : []);
      }
    }
    return json(null);
  }) as typeof fetch;
  return calls;
}

async function drive(
  overrides: Record<string, unknown>,
  opts: RecorderOpts & { badSig?: boolean; staleTs?: boolean } = {},
) {
  setupEnv();
  const raw = JSON.stringify({
    transferType: "in",
    id: 12345,
    referenceCode: "REF-TEST",
    ...overrides,
  });
  const ts = opts.staleTs ? Math.floor(Date.now() / 1000) - 600 : Math.floor(Date.now() / 1000);
  const sig = opts.badSig
    ? "sha256=chu-ky-khong-hop-le"
    : `sha256=${createHmac("sha256", TEST_SECRET).update(`${ts}.${raw}`).digest("hex")}`;

  const calls = recorder(opts);
  const res = await POST(
    new NextRequest("https://checkbds.test/api/sepay/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sepay-signature": sig,
        "x-sepay-timestamp": String(ts),
      },
      body: raw,
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, calls };
}

/** Ghì nhận quyền lợi: PATCH/POST vào bảng users (GET đọc hạn dùng thì KHÔNG tính). */
function usersWrites(calls: Call[]): Call[] {
  return calls.filter((c) => c.table === "users" && c.method !== "GET");
}

/** Mọi ghi vào payments, kèm body đã parse. */
function paymentsWrites(calls: Call[]): { method: string; body: Record<string, unknown> }[] {
  return calls
    .filter((c) => c.table === "payments" && c.method !== "GET")
    .map((c) => ({ method: c.method, body: c.body ? JSON.parse(c.body) : {} }));
}

/** Assert trả về unmatched và KHÔNG ghi gì vào users. */
function assertRejected(where: string, res: { body: Record<string, unknown>; calls: Call[] }) {
  assert.ok(res.body.unmatched, `${where}: phải trả unmatched`);
  assert.equal(usersWrites(res.calls).length, 0, `${where}: không được ghi users`);
}

async function main() {
  console.log("\n== VAL-DURATION: số tháng + tiền phải khớp ==");

  await check("T12 chỉ chuyển 1000 -> không nâng gói (lỗ hổng cũ)", async () => {
    const res = await drive({ content: `NANGCAP ${UUID} T12`, transferAmount: 1000 });
    assert.equal(res.status, 200);
    assertRejected("T12/1000", res);
    for (const w of paymentsWrites(res.calls)) {
      assert.equal(w.body.status, "unmatched", "không được ghi ledger paid");
      assert.equal(w.body.plan, "unmatched", "không được ghi ledger pro");
    }
  });

  for (const n of [2, 24]) {
    await check(`T${n} chuyển 1000 -> không nâng gói`, async () => {
      const res = await drive({ content: `NANGCAP ${UUID} T${n}`, transferAmount: 1000 });
      assert.equal(res.status, 200);
      assertRejected(`T${n}/1000`, res);
    });
  }

  for (const n of [2, 3, 6, 12]) {
    await check(`T${n} đúng giá quotePrice(${n}).total -> pro ${n} tháng`, async () => {
      const content = transferContent(UUID, n);
      const res = await drive({ content, transferAmount: quotePrice(n).total });
      assert.equal(res.status, 200);
      assert.equal(res.body.plan, "pro", "phải cấp pro");
      assert.equal(res.body.months, n, "phải cấp đúng số tháng");
      assert.ok(res.body.plan_expires_at, "phải có plan_expires_at");
      // Hạn dùng cũ rỗng -> nextExpiry cộng 30*n ngày từ bây giờ
      const days = (new Date(String(res.body.plan_expires_at)).getTime() - Date.now()) / 86400000;
      assert.ok(days > 30 * n - 2 && days <= 30 * n + 1, `hạn phải ~${30 * n} ngày, được ${days}`);
      assert.equal(usersWrites(res.calls).length, 1, "phải ghi đúng 1 lần users");
      const patch = usersWrites(res.calls)[0];
      assert.equal(JSON.parse(patch.body ?? "{}").plan, "pro");
    });
  }

  await check("tháng không có gói giá (4,5,7..24) dù chuyển nhiều vẫn bị từ chối", async () => {
    const khongCoGia = [4, 5, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
    for (const n of khongCoGia) {
      const res = await drive({ content: `NANGCAP ${UUID} T${n}`, transferAmount: 799000 });
      assert.equal(res.status, 200);
      assertRejected(`T${n}/799000`, res);
    }
  });

  await check("T12 chuyển sai giá (1 tháng hoặc 3 tháng) -> không nâng gói", async () => {
    for (const amount of [quotePrice(1).total, quotePrice(3).total]) {
      const res = await drive({ content: `NANGCAP ${UUID} T12`, transferAmount: amount });
      assert.equal(res.status, 200);
      assertRejected(`T12/${amount}`, res);
    }
  });

  console.log("\n== VAL-DURATION-006: ngưỡng dưới bao gồm cả bằng ==");

  for (const n of [2, 12]) {
    const total = quotePrice(n).total;
    const content = transferContent(UUID, n);

    await check(`T${n}: đúng bằng ${total} -> cấp (so sánh >=, không phải ===)`, async () => {
      const res = await drive({ content, transferAmount: total });
      assert.equal(res.status, 200);
      assert.equal(res.body.plan, "pro");
      assert.equal(res.body.months, n);
      assert.equal(usersWrites(res.calls).length, 1);
    });

    await check(`T${n}: thiếu 1 đồng (${total - 1}) -> từ chối`, async () => {
      const res = await drive({ content, transferAmount: total - 1 });
      assert.equal(res.status, 200);
      assertRejected(`T${n}/${total - 1}`, res);
    });

    await check(`T${n}: chuyển thừa ${total + 1000} -> vẫn cấp (floor, không ép khớp tuyệt đối)`, async () => {
      const res = await drive({ content, transferAmount: total + 1000 });
      assert.equal(res.status, 200);
      assert.equal(res.body.plan, "pro");
      assert.equal(res.body.months, n);
      assert.equal(usersWrites(res.calls).length, 1);
    });
  }

  console.log("\n== VAL-DURATION-007: tiền 0 / âm / NaN ==");

  await check("T12 với tiền 0 -> từ chối", async () => {
    const res = await drive({ content: `NANGCAP ${UUID} T12`, transferAmount: 0 });
    assertRejected("T12/0", res);
  });

  await check("T12 với tiền âm -> từ chối", async () => {
    const res = await drive({ content: `NANGCAP ${UUID} T12`, transferAmount: -1000 });
    assertRejected("T12/-1000", res);
  });

  await check("T12 với tiền không phải số (NaN) -> từ chối", async () => {
    const res = await drive({ content: `NANGCAP ${UUID} T12`, transferAmount: "khong-phai-so" });
    assertRejected("T12/NaN", res);
  });

  console.log("\n== VAL-SINGLE: đường 1 tháng giữ nguyên ==");

  await check("1 tháng đúng giá 299000 -> pro, 30 ngày, ghi users 1 lần", async () => {
    const res = await drive({ content: transferContent(UUID, 1), transferAmount: 299000 });
    assert.equal(res.status, 200);
    assert.equal(res.body.plan, "pro");
    assert.equal(res.body.months, 1);
    const days = (new Date(String(res.body.plan_expires_at)).getTime() - Date.now()) / 86400000;
    assert.ok(days > 28 && days <= 31, `hạn phải ~30 ngày, được ${days}`);
    assert.equal(usersWrites(res.calls).length, 1);
    assert.equal(JSON.parse(usersWrites(res.calls)[0].body ?? "{}").plan, "pro");
  });

  await check("1 tháng thiếu tiền (298999 và 1000) -> từ chối", async () => {
    for (const amount of [298999, 1000]) {
      const res = await drive({ content: transferContent(UUID, 1), transferAmount: amount });
      assert.equal(res.status, 200);
      assertRejected(`1 tháng/${amount}`, res);
    }
  });

  await check("1 tháng chuyển thừa (350000) -> vẫn pro (giữ ngưỡng >=)", async () => {
    const res = await drive({ content: transferContent(UUID, 1), transferAmount: 350000 });
    assert.equal(res.status, 200);
    assert.equal(res.body.plan, "pro");
    assert.equal(res.body.months, 1);
  });

  await check("đủ giá Team (799000) -> team (giữ dải planFromAmount)", async () => {
    const res = await drive({ content: transferContent(UUID, 1), transferAmount: 799000 });
    assert.equal(res.status, 200);
    assert.equal(res.body.plan, "team");
    assert.equal(usersWrites(res.calls).length, 1);
  });

  console.log("\n== VAL-PARSE: token số tháng lỗi ==");

  for (const token of ["T99", "T0", "T"]) {
    await check(`token ${token} + 299000 -> coi là 1 tháng, cấp pro`, async () => {
      const res = await drive({ content: `NANGCAP ${UUID} ${token}`, transferAmount: 299000 });
      assert.equal(res.status, 200);
      assert.equal(res.body.plan, "pro");
      assert.equal(res.body.months, 1);
    });

    await check(`token ${token} + 1000 -> coi là 1 tháng, từ chối`, async () => {
      const res = await drive({ content: `NANGCAP ${UUID} ${token}`, transferAmount: 1000 });
      assert.equal(res.status, 200);
      assertRejected(`${token}/1000`, res);
    });
  }

  await check("số tiền không map được gói (10000, NaN) -> từ chối", async () => {
    for (const amount of [10000, "khong-phai-so"]) {
      const res = await drive({ content: transferContent(UUID, 1), transferAmount: amount });
      assert.equal(res.status, 200);
      assertRejected(`1 tháng/${amount}`, res);
    }
  });

  console.log("\n== VAL-LEDGER: idempotent + ledger ==");

  await check("giao dịch trùng sepay_ref -> skipped:duplicate, không ghi users", async () => {
    const res = await drive(
      { content: transferContent(UUID, 3), transferAmount: quotePrice(3).total, id: 99990 },
      { existingPaidRef: true },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.skipped, "duplicate");
    assert.equal(usersWrites(res.calls).length, 0, "không được nâng gói lần nữa");
    assert.equal(paymentsWrites(res.calls).length, 0, "không được ghi thêm bản ghi paid");
  });

  await check("mọi giao dịch bị từ chối chỉ ghi ledger unmatched", async () => {
    for (const over of [
      { content: transferContent(UUID, 1), transferAmount: 298999 },
      { content: transferContent(UUID, 1), transferAmount: 1000 },
      { content: `NANGCAP ${UUID} T12`, transferAmount: 1000 },
      { content: `NANGCAP ${UUID} T4`, transferAmount: 799000 },
      { content: `NANGCAP ${UUID} T24`, transferAmount: 1000 },
    ]) {
      const res = await drive(over);
      assertRejected(String(over.content), res);
      const writes = paymentsWrites(res.calls);
      assert.equal(writes.length, 1, "chỉ được ghi đúng 1 bản ghi payments");
      assert.equal(writes[0].body.status, "unmatched");
      assert.equal(writes[0].body.plan, "unmatched");
    }
  });

  await check("có bản ghi pending khớp nội dung CK -> update thành paid, không insert thêm", async () => {
    const content = transferContent(UUID, 3);
    const res = await drive({ content, transferAmount: quotePrice(3).total }, { pendingRow: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.plan, "pro");
    assert.equal(res.body.months, 3);
    const writes = paymentsWrites(res.calls);
    assert.equal(writes.length, 1, "không được ghi 2 lần");
    assert.equal(writes[0].method, "PATCH", "bản ghi pending phải được update");
    assert.equal(writes[0].body.status, "paid");
  });

  console.log("\n== VAL-AUTH: auth + inbound ==");

  await check("transferType không phải in -> skipped:not-inbound, không ghi gì", async () => {
    const res = await drive({ transferType: "out" });
    assert.equal(res.status, 200);
    assert.equal(res.body.skipped, "not-inbound");
    assert.equal(res.calls.length, 0, "không được có request Supabase nào");
  });

  await check("chữ ký HMAC sai -> 401, không ghi gì", async () => {
    const res = await drive(
      { content: transferContent(UUID, 1), transferAmount: 299000 },
      { badSig: true },
    );
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.calls.length, 0, "không được có request Supabase nào");
  });

  await check("timestamp cũ -> 401, không ghi gì", async () => {
    const res = await drive(
      { content: transferContent(UUID, 1), transferAmount: 299000 },
      { staleTs: true },
    );
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.calls.length, 0);
  });

  await check("đúng chữ ký -> 200 (đối chứng với case 401)", async () => {
    const res = await drive({ content: transferContent(UUID, 1), transferAmount: 299000 });
    assert.equal(res.status, 200);
  });

  await check("nội dung CK không nhận ra người chuyển -> unmatched, không ghi users", async () => {
    const res = await drive({ content: "MBVCB.123.CT tu NGUYEN VAN A" });
    assert.equal(res.status, 200);
    assert.equal(res.body.unmatched, "khong-nhan-dien-duoc-nguoi-chuyen");
    assert.equal(usersWrites(res.calls).length, 0);
  });

  console.log("\n== VAL-CROSS-001: mọi gói trong DURATIONS round-trip ==");

  await check("từng gói trong DURATIONS đều được chấp nhận đúng số tháng", async () => {
    const duocCap: number[] = [];
    for (const d of DURATIONS) {
      const res = await drive({
        content: transferContent(UUID, d.months),
        transferAmount: quotePrice(d.months).total,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.plan, "pro", `gói ${d.months} tháng phải ra pro`);
      assert.equal(res.body.months, d.months);
      assert.equal(usersWrites(res.calls).length, 1);
      duocCap.push(d.months);
    }
    assert.deepEqual(duocCap, [1, 2, 3, 6, 12], "tập gói nhận phải đúng DURATIONS");
    for (const n of [4, 5, 7, 11, 13, 24]) {
      assert.ok(!duocCap.includes(n), `gói ${n} tháng không được nhận`);
    }
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
