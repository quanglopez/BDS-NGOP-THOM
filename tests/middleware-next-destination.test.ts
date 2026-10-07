// Self-check: middleware giữ ĐẦY ĐỦ destination (pathname + query) trong `next`
// khi anonymous user vào route được bảo vệ. Chạy: npm test
//
// Import middleware THẬT (không assert source string) và drive bằng NextRequest,
// cùng convention với tests/radar-enrichment-cron-route.test.ts.
// Không có cookie session -> supabase.auth.getUser() trả user=null KHÔNG cần
// network, nên nhánh anonymous chạy được ngoài Next runtime.
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9/unreachable";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";

const ORIGIN = "https://www.checkbds.online";

let pass = 0;
let fail = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}

/** Chạy middleware cho 1 URL, trả về Location header (null nếu không redirect). */
async function redirectFor(pathWithQuery: string): Promise<string | null> {
  const res = await updateSession(new NextRequest(ORIGIN + pathWithQuery));
  if (res.status < 300 || res.status >= 400) return null;
  return res.headers.get("location");
}

/** Location phải là /login?next=<encoded internal destination>. */
function expectNext(location: string | null, expectedDestination: string) {
  assert.ok(location, "phải có redirect");
  const url = new URL(location!, ORIGIN);
  assert.equal(url.origin, ORIGIN, "redirect phải ở lại host nội bộ");
  assert.equal(url.pathname, "/login", "redirect phải tới /login");
  assert.equal(
    url.searchParams.get("next"),
    expectedDestination,
    `next phải là destination đầy đủ, nhận được ${JSON.stringify(url.searchParams.get("next"))}`,
  );
}

async function main() {
  console.log("\n== destination: pathname + query được giữ trong next ==");

  await check("/admin (không query) -> /login?next=%2Fadmin", async () => {
    expectNext(await redirectFor("/admin"), "/admin");
  });

  await check("/dashboard (không query) -> /login?next=%2Fdashboard", async () => {
    expectNext(await redirectFor("/dashboard"), "/dashboard");
  });

  await check("/admin?q=test -> next=/admin?q=test", async () => {
    expectNext(await redirectFor("/admin?q=test"), "/admin?q=test");
  });

  await check("/admin?q=test&page=2 -> giữ cả 2 key", async () => {
    expectNext(await redirectFor("/admin?q=test&page=2"), "/admin?q=test&page=2");
  });

  await check("/admin?foo=bar&foo=baz -> giữ repeated key", async () => {
    const loc = await redirectFor("/admin?foo=bar&foo=baz");
    const url = new URL(loc!, ORIGIN);
    const dest = url.searchParams.get("next")!;
    assert.deepEqual(new URL(dest, ORIGIN).searchParams.getAll("foo"), ["bar", "baz"]);
  });

  await check("/dashboard?tab=history -> next=/dashboard?tab=history", async () => {
    expectNext(await redirectFor("/dashboard?tab=history"), "/dashboard?tab=history");
  });

  await check("query value đã encode -> giữ nguyên encoding gốc", async () => {
    expectNext(
      await redirectFor("/dashboard?search=Nguyen%20Van%20A"),
      "/dashboard?search=Nguyen%20Van%20A",
    );
  });

  await check("KHÔNG có trailing ? khi không có query", async () => {
    const loc = await redirectFor("/admin");
    const url = new URL(loc!, ORIGIN);
    assert.equal(url.searchParams.get("next"), "/admin");
    assert.ok(!url.searchParams.get("next")!.endsWith("?"), "không được có ? thừa");
  });

  await check("query gốc KHÔNG rò ra top-level của /login", async () => {
    const loc = await redirectFor("/admin?q=test");
    const url = new URL(loc!, ORIGIN);
    assert.equal(url.searchParams.get("q"), null, "q không được thành tham số của /login");
    assert.deepEqual([...url.searchParams.keys()], ["next"]);
  });

  console.log("\n== bảo mật: query là DATA, không điều khiển được host ==");

  const attacks = [
    "/admin?next=https://evil.example",
    "/admin?next=//evil.example",
    "/admin?next=%2F%2Fevil.example",
    "/admin?url=https://evil.example",
    "/admin?q=https://evil.example",
    "/admin?x=%0d%0aLocation:%20https://evil.example",
    "/admin?x=<script>alert(1)</script>",
    "/admin?x=../foo",
    "/admin?x=%2E%2E%2Ffoo",
    "/admin?q=%2F%2Fevil.example",
    "/admin?q=\\evil.example",
    "/admin?q=%5C%5Cevil.example",
    "/admin?redirect=%2Ffoo",
  ];

  for (const path of attacks) {
    await check(`không thoát host: ${path}`, async () => {
      const loc = await redirectFor(path);
      assert.ok(loc, "phải có redirect");
      const url = new URL(loc!, ORIGIN);
      assert.equal(url.origin, ORIGIN, "host phải là host nội bộ");
      assert.equal(url.pathname, "/login");
      const dest = url.searchParams.get("next")!;
      assert.ok(dest.startsWith("/admin"), `destination phải bắt đầu bằng /admin, nhận ${dest}`);
      // Toàn bộ query của destination phải là data bên trong `next`,
      // không được trở thành tham số điều khiển của /login.
      assert.deepEqual([...url.searchParams.keys()], ["next"]);
    });
  }

  console.log("\n== /login + /api/admin không đổi hành vi ==");

  await check("/login (anonymous) -> không redirect", async () => {
    assert.equal(await redirectFor("/login"), null);
  });

  // /api/admin/* KHÔNG khớp startsWith("/admin") nên anonymous đi thẳng qua
  // middleware (route API tự xử lý auth). Giữ nguyên hành vi này.
  await check("/api/admin (anonymous) -> đi thẳng, không redirect", async () => {
    assert.equal(await redirectFor("/api/admin/users"), null);
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

void main();