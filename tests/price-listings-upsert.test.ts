// Self-check: upsert market_listings KHÔNG được gửi first_seen_at.
// Chạy: npm test — không network, không DB.
//
// BUG ĐÃ XẢY RA Ở PRODUCTION (2026-09-29):
//   lib/price/repos.ts gửi `first_seen_at: undefined` với ý đồ "giữ cột này".
//   Nhưng postgrest-js dựng tham số `columns=` từ Object.keys() của object:
//     const columns = values.reduce((acc, x) => acc.concat(Object.keys(x)), [])
//   Object.keys thấy first_seen_at dù value là undefined, nên cột vẫn được
//   đưa vào `columns=`. Đồng thời defaultToNull=true nên KHÔNG gửi
//   `Prefer: missing=default`, và JSON.stringify() bỏ mất key undefined.
//   Kết quả: PostgREST insert NULL tường minh cho first_seen_at, mà NULL tường minh
//   không rơi về DEFAULT now() -> 23502 not_null_violation -> HTTP 400.
//   Mọi batch đều chết, market_listings rỗng 0 dòng.
//
// Test này dùng client postgrest-js THẬT với fetch giả, nên nó khóa chính xác
// hành vi của thư viện thay vì mô phỏng lại logic của thư viện.
import { strict as assert } from "node:assert";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseMarketListings } from "../lib/price/repos.ts";
import { PricePipelineError } from "../lib/price/errors.ts";
import type { NormalizedListing } from "../lib/price/types.ts";

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

interface Captured {
  url: string;
  prefer: string;
  /** Body sau khi đi qua JSON — đúng thứ PostgREST nhận. */
  body: Record<string, unknown>[];
  /** Danh sách cột PostgREST ngầm định suy ra, decode từ `columns=`. */
  columns: string[];
  calls: number;
}

function mkListing(over: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    source: "chotot_gateway",
    external_id: "134485828",
    category_code: 1000,
    category_name: "Đất bán",
    region_name: "Tp Hồ Chí Minh",
    region_v2: 13000,
    area_name: "Quận 6",
    area_v2: 301704,
    title: "Bán đất mặt tiền",
    price_vnd: 4_550_000_000,
    size_m2: 65,
    living_size_m2: null,
    land_front_m: 5,
    land_side_m: 20,
    rooms: null,
    price_per_m2: 70_000_000,
    lat: 16.107,
    lng: 108.252,
    listed_at: "2026-09-29T12:00:00.000Z",
    url: "https://www.nhatot.com/tin/134485828.htm",
    is_price_valid: true,
    is_promoted: false,
    is_rent: false,
    ...over,
  };
}

/**
 * Client supabase-js thật (đúng `createClient` mà lib/admin.ts dùng), fetch giả.
 * Gọi upsertMany sẽ đi hết đường .from().upsert() của thư viện rồi dừng ở tầng
 * network, nên test kiểm được đúng thứ PostgREST sẽ nhận chứ không phải bản sao.
 */
function capturingClient(opts: { errorBody?: unknown } = {}): { client: SupabaseClient; captured: Captured } {
  const captured: Captured = { url: "", prefer: "", body: [], columns: [], calls: 0 };

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    captured.calls += 1;
    captured.url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? {});
    captured.prefer = headers.get("Prefer") ?? "";
    const raw = typeof init?.body === "string" ? init.body : "";
    captured.body = raw ? (JSON.parse(raw) as Record<string, unknown>[]) : [];

    const url = new URL(captured.url);
    const columnsParam = url.searchParams.get("columns");
    captured.columns = columnsParam
      ? columnsParam.split(",").map((c) => c.replace(/^"|"$/g, ""))
      : [];

    const status = opts.errorBody ? 400 : 201;
    const payload = opts.errorBody ?? null;
    return new Response(payload === null ? "" : JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };

  const client = createClient(
    "https://example.supabase.co",
    "test-service-role-key",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fakeFetch as unknown as typeof fetch },
    },
  );

  return { client, captured };
}

async function main() {
  console.log(
    "\n== market_listings upsert: first_seen_at phải VẮNG mặt khỏi payload ==\n",
  );

  await check(
    "market_listings upsert does not include first_seen_at undefined",
    async () => {
      const { client, captured } = capturingClient();
      await supabaseMarketListings(client).upsertMany([mkListing()]);

      assert.equal(captured.calls, 1, "phải đúng 1 request");
      assert.ok(
        captured.url.includes("/market_listings"),
        `sai bảng: ${captured.url}`,
      );
      assert.ok(
        captured.url.includes("on_conflict=source%2Cexternal_id"),
        `sai on_conflict: ${captured.url}`,
      );

      // 1. Tham số columns= của PostgREST KHÔNG được chứa first_seen_at.
      assert.ok(
        !captured.columns.includes("first_seen_at"),
        `columns= vẫn chứa first_seen_at: ${captured.columns.join(",")}`,
      );

      // 2. Key trong body gửi đi KHÔNG được chứa first_seen_at.
      const row = captured.body[0];
      assert.ok(row, "body phải có 1 dòng");
      assert.ok(
        !("first_seen_at" in row),
        `body vẫn có key first_seen_at (giá trị: ${String(row.first_seen_at)})`,
      );

      // 3. last_seen_at vẫn phải có — không được xoá nhầm cột này.
      assert.equal(typeof row.last_seen_at, "string", "phải còn last_seen_at");
      assert.ok(
        !Number.isNaN(Date.parse(row.last_seen_at as string)),
        "last_seen_at phải là ISO hợp lệ",
      );
    },
  );

  await check("batch nhiều tin: không dòng nào có first_seen_at", async () => {
    const { client, captured } = capturingClient();
    await supabaseMarketListings(client).upsertMany([
      mkListing({ external_id: "a1" }),
      mkListing({ external_id: "a2" }),
      mkListing({ external_id: "a3" }),
    ]);

    assert.equal(captured.body.length, 3);
    for (const row of captured.body) {
      assert.ok(
        !("first_seen_at" in row),
        `dòng ${String(row.external_id)} có first_seen_at`,
      );
    }
    assert.ok(!captured.columns.includes("first_seen_at"));
  });

  // Test này KHÔNG gọi upsertMany. Nó khoanh đúng cơ chế làm hỏng payload, để
  // lần sau ai đó "tối ưu" lại bằng undefined thì hiểu ngay vì sao sai.
  await check(
    "cơ chế: 1 dòng có key undefined làm nhiễm columns= cho CẢ batch",
    async () => {
      // Đúng cái bug ở production: first_seen_at: undefined.
      const poisoned = { ...mkListing(), first_seen_at: undefined };
      const columns = [poisoned, mkListing({ external_id: "b2" })].reduce<string[]>(
        (acc, x) => acc.concat(Object.keys(x)),
        [],
      );
      const uniqueColumns = [...new Set(columns)].map((c) => `"${c}"`);

      assert.ok(
        uniqueColumns.includes('"first_seen_at"'),
        "giả định sai: columns phải bị nhiễm mới chứng minh được lỗi",
      );
      // Nhưng JSON gửi đi thì KHÔNG có key này -> PostgREST thấy cột trong
      // columns= mà body không có value -> insert NULL tường minh -> 23502.
      const wire = JSON.parse(JSON.stringify([poisoned])) as Record<string, unknown>[];
      assert.ok(
        !("first_seen_at" in wire[0]),
        "JSON.stringify phải bỏ mất key undefined",
      );

      // Không có `Prefer: missing=default` thì PostgREST không dùng DEFAULT cho
      // cột thiếu, mà insert NULL tường minh. upsert() mặc định defaultToNull=true.
      const { client, captured } = capturingClient();
      await supabaseMarketListings(client).upsertMany([mkListing()]);
      assert.ok(
        !captured.prefer.includes("missing=default"),
        `Prefer phải KHÔNG có missing=default, thực tế: ${captured.prefer}`,
      );
    },
  );

  await check("mảng rỗng -> không gọi network", async () => {
    const { client, captured } = capturingClient();
    await supabaseMarketListings(client).upsertMany([]);
    assert.equal(captured.calls, 0, "không được gọi request rỗng");
  });

  await check("lỗi 23502 từ PostgREST -> ném listing_upsert_failed", async () => {
    const { client } = capturingClient({
      errorBody: {
        code: "23502",
        message:
          'null value in column "first_seen_at" of relation "market_listings" violates not-null constraint',
        details: null,
        hint: null,
      },
    });
    await assert.rejects(
      () => supabaseMarketListings(client).upsertMany([mkListing()]),
      (e: unknown) => {
        assert.ok(e instanceof PricePipelineError, "phải là PricePipelineError");
        assert.equal(e.code, "listing_upsert_failed");
        return true;
      },
    );
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
