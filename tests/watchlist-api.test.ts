// Self-check: /api/watchlist data/API — auth, XOR anchor, ownership,
// radar resolve, idempotent duplicate, PATCH guard, DELETE, quota invariant.
import type { SupabaseClient, AuthError } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  handleGet,
  handlePost,
  handlePatch,
  handleDelete,
  handleGetByCheck,
} from "../lib/watchlist/handlers.ts";
import type { WatchlistDeps } from "../lib/watchlist/handlers.ts";

type Row = Record<string, unknown>;

const USER = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-1111-4222-8333-444444444444";
const CHECK_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RADAR_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const LISTING_ID = "cccccccc-dddd-4eee-8fff-000000000000";
const ITEM_ID = "dddddddd-eeee-4fff-8000-111111111111";
const OTHER_ITEM_ID = "eeeeeeee-ffff-4000-8000-222222222222";

const FULL_CHECK: Partial<Row> = {
  id: CHECK_ID,
  user_id: USER,
  seo_slug: "nha-xa-hoang",
  score: 82,
  deal_type: "ban",
  is_ngop: 18,
  province: "HCM",
  price_billion: 1.5,
  area_m2: 55,
  created_at: "2026-09-20T10:00:00Z",
  listing_url: "https://example.com/xa-hoang",
};

/** AuthError-like shape (PostgREST error + message + __isAuthError). */
function authSessionMissing(): AuthError {
  const e: Partial<AuthError> & { __isAuthError: true; code?: string } = {
    __isAuthError: true,
    message: "Auth session missing!",
    name: "AuthSessionMissingError",
  };
  return e as unknown as AuthError;
}

/** Supabase giả: row-store cho 5 bảng; mọi insert/update/delete ghi lên. */
function fakeDb(opts?: {
  authed?: boolean;
  checkOwned?: boolean;
  checks?: Row[];
  items?: Row[];
  queryError?: { table?: string; code?: string; msg?: string };
  getUserError?: unknown;
}) {
  const authed = opts?.authed !== false;
  const checkOwned = opts?.checkOwned !== false;
  const items: Row[] = opts?.items
    ? [...opts.items]
    : [
        {
          id: ITEM_ID,
          user_id: USER,
          check_id: CHECK_ID,
          market_listing_id: null,
          status: "moi_luu",
          note: null,
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-01T00:00:00Z",
        },
        {
          id: OTHER_ITEM_ID,
          user_id: OTHER,
          check_id: "ffffffff-0000-4000-8000-333333333333",
          market_listing_id: null,
          status: "moi_luu",
          note: null,
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-01T00:00:00Z",
        },
      ];
  const checks: Row[] = opts?.checks ?? [checkOwned ? { ...FULL_CHECK } : { ...FULL_CHECK, user_id: OTHER }];
  const radars = [{ id: RADAR_ID, user_id: USER }];
  const radarMatches = [{ radar_id: RADAR_ID, external_id: "ext-1" }];
  const marketListings = [
    {
      id: LISTING_ID,
      external_id: "ext-1",
      title: "Nhà X",
      url: "https://example.com/listing",
      price_vnd: 1e9,
      size_m2: 50,
      area_name: "Q7",
      region_name: "HCM",
    },
  ];
  const inserts: Row[] = [];
  const updates: Row[] = [];
  const deletes: Row[] = [];

  const qe = opts?.queryError;

  function rowsOf(table: string): Row[] {
    if (table === "watchlist_items") return items;
    if (table === "checks") return checks;
    if (table === "radars") return radars;
    if (table === "radar_matches") return radarMatches;
    if (table === "market_listings") return marketListings;
    return [];
  }

  function chain(tbl: string) {
    const ctx: { filters: [string, unknown][] } = { filters: [] };
    const self = {
      select: () => self,
      in: (k: string, vs: unknown[]) => {
        ctx.filters.push([k, vs[0]] as [string, unknown]);
        return self;
      },
      eq: (k: string, v: unknown) => {
        ctx.filters.push([k, v]);
        return self;
      },
      order: () => self,
      maybeSingle: async () => {
        if (qe?.table === tbl) {
          return { data: null, error: { code: qe.code, message: qe.msg } };
        }
        return {
          data: rowsOf(tbl).filter((r) => ctx.filters.every(([k, v]) => r[k] === v))[0] ?? null,
          error: null,
        };
      },
      single: async () => {
        if (qe?.table === tbl) {
          return { data: null, error: { code: qe.code, message: qe.msg } };
        }
        return {
          data: rowsOf(tbl).filter((r) => ctx.filters.every(([k, v]) => r[k] === v))[0] ?? null,
          error: null,
        };
      },
      insert: (payload: Row) => ({
        select: () => ({
          single: async () => {
            inserts.push({ table: tbl, ...payload });
            if (payload.user_id === USER || payload.user_id === OTHER) {
              const existing = rowsOf("watchlist_items").filter(
                (it) =>
                  it.user_id === payload.user_id &&
                  (payload.check_id === undefined || it.check_id === payload.check_id) &&
                  (payload.market_listing_id === undefined ||
                    it.market_listing_id === payload.market_listing_id),
              );
              if (existing.length > 0) {
                return { data: null, error: { code: "23505", message: "duplicate" } };
              }
              const row: Row = {
                id: crypto.randomUUID(),
                created_at: "2026-10-08T00:00:00Z",
                updated_at: "2026-10-08T00:00:00Z",
                ...payload,
              };
              items.push(row);
            }
            return { data: { id: crypto.randomUUID(), ...payload }, error: null };
          },
        }),
      }),
      // update/delete trả về builder riêng: PostgREST cho phép .eq() nối tiếp
      // nhiều lần TRƯỚC .select(), nên .eq() phải giữ nguyên builder gốc chứ
      // không rơi về `self` (bug thật của test double cũ).
      update: (payload: Row) => {
        const upd = {
          eq: (k: string, v: unknown) => {
            ctx.filters.push([k, v]);
            return upd;
          },
          select: () => ({
            maybeSingle: async () => {
              if (qe?.table === tbl) {
                return { data: null, error: { code: qe.code, message: qe.msg } };
              }
              updates.push({ table: tbl, ...payload });
              const matched = rowsOf(tbl).filter((r) =>
                ctx.filters.every(([k, v]) => r[k] === v),
              );
              for (const r of matched) Object.assign(r, payload);
              return { data: matched[0] ?? null, error: null };
            },
          }),
        };
        return upd;
      },
      delete: () => {
        const del = {
          eq: (k: string, v: unknown) => {
            ctx.filters.push([k, v]);
            return del;
          },
          select: async (cols?: unknown) => {
            if (qe?.table === tbl) {
              return { data: null, error: { code: qe.code, message: qe.msg } };
            }
            const matched = rowsOf(tbl).filter((r) =>
              ctx.filters.every(([k, v]) => r[k] === v),
            );
            for (const r of [...matched]) items.splice(items.indexOf(r), 1);
            deletes.push(...matched);
            return { data: matched.map((r) => ({ id: r.id })), error: null };
          },
        };
        return del;
      },
      then: (resolve: (v: unknown) => unknown) =>
        resolve(
          qe?.table === tbl
            ? { data: null, error: { code: qe.code, message: qe.msg } }
            : {
                data: rowsOf(tbl).filter((r) => ctx.filters.every(([k, v]) => r[k] === v)),
                error: null,
              },
        ),
    };
    return self;
  }

  const client: unknown = {
    from: (t: string) => chain(t),
    auth: {
      getUser: async () => {
        if (opts?.getUserError) {
          return { data: { user: null }, error: opts.getUserError };
        }
        if (!authed) {
          return { data: { user: null }, error: null };
        }
        return { data: { user: { id: USER } }, error: null };
      },
    },
  };
  return { client, inserts, updates, deletes, items, checks };
}

function depsFrom(client: unknown): WatchlistDeps {
  return {
    createSupabaseClient: async () => client as SupabaseClient,
    adminClient: () => client as SupabaseClient,
  };
}

function req(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://x/api/watchlist", {
    method: "POST",
    body: JSON.stringify(body),
    ...init,
  });
}

let pass = 0;
let fail = 0;
function check(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(() => fn())
    .then(
      () => {
        pass++;
        console.log(`  ✓ ${name}`);
      },
      (e) => {
        fail++;
        console.log(`  ✗ ${name}: ${e.message}`);
      },
    );
}

await check("unauthenticated -> 401 (GET/POST/PATCH/DELETE)", async () => {
  const { client } = fakeDb({ authed: false });
  const deps = depsFrom(client);
  const g = await handleGet(deps);
  assert.equal(g.status, 401);
  const p = await handlePost(req({ checkId: CHECK_ID }), deps);
  assert.equal(p.status, 401);
  const pa = await handlePatch(
    { params: Promise.resolve({ id: ITEM_ID }) },
    req({ status: "da_goi" }),
    deps,
  );
  assert.equal(pa.status, 401);
  const de = await handleDelete(
    { params: Promise.resolve({ id: ITEM_ID }) },
    deps,
  );
  assert.equal(de.status, 401);
});

await check("anonymous auth shape: user null + AuthSessionMissingError -> 401", async () => {
  const { client } = fakeDb({ authed: false, getUserError: authSessionMissing() });
  const deps = depsFrom(client);
  const res = await handleGet(deps);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, "Cần đăng nhập");
});

await check("GET trả về items của user", async () => {
  const { client } = fakeDb();
  const res = await handleGet(depsFrom(client));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].id, ITEM_ID);
});

await check("GET ?checkId: malformed -> 400; valid -> full item", async () => {
  const { client } = fakeDb();
  const res400 = await handleGetByCheck(
    new Request("https://x/api/watchlist?checkId=not-a-uuid"),
    depsFrom(client),
  );
  assert.equal(res400.status, 400);

  const res200 = await handleGetByCheck(
    new Request(`https://x/api/watchlist?checkId=${CHECK_ID}`),
    depsFrom(client),
  );
  assert.equal(res200.status, 200);
  const body = await res200.json();
  assert.equal(body.item?.id, ITEM_ID);
  assert.equal(body.item?.check?.score, 82);
  assert.equal(body.item?.check?.isNgoP, 18);
});

await check("POST check: own -> 201; foreign -> 404; malformed checkId -> 400", async () => {
  const own = fakeDb({ checkOwned: true, items: [] });
  const r1 = await handlePost(req({ checkId: CHECK_ID }), depsFrom(own.client));
  const body1 = await r1.json();
  assert.equal(r1.status, 201);
  assert.equal(body1.item?.anchor, "check");
  assert.ok(body1.item?.check, "item.check phải có");
  assert.equal(body1.item?.check?.score, 82);
  assert.equal(body1.item?.check?.isNgoP, 18, "is_ngop numeric preserved");

  const foreign = fakeDb({ checkOwned: false });
  const r2 = await handlePost(req({ checkId: CHECK_ID }), depsFrom(foreign.client));
  assert.equal(r2.status, 404);

  const bad = await handlePost(req({ checkId: "not-a-uuid" }), depsFrom(own.client));
  assert.equal(bad.status, 400);
});

await check("duplicate POST returns full check detail (same shape)", async () => {
  const { client } = fakeDb({ checkOwned: true, items: [] });
  const r1 = await handlePost(req({ checkId: CHECK_ID }), depsFrom(client));
  assert.equal(r1.status, 201);
  const first = await r1.json();
  assert.equal(first.item?.check?.score, 82);
  assert.equal(first.item?.check?.isNgoP, 18);

  const r2 = await handlePost(req({ checkId: CHECK_ID }), depsFrom(client));
  const body = await r2.json();
  assert.equal(r2.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(body.item?.anchor, "check");
  assert.equal(body.item?.check?.score, 82);
  assert.equal(body.item?.check?.isNgoP, 18);
  assert.equal(body.item?.check?.seoSlug, "nha-xa-hoang");
  assert.equal(body.item?.check?.province, "HCM");
  assert.equal(body.item?.check?.priceBillion, 1.5);
  assert.equal(body.item?.check?.areaM2, 55);
  assert.equal(body.item?.check?.listingUrl, "https://example.com/xa-hoang");
});

await check("POST radar: own -> 201; radar/externalId lạ -> 404; market_listing miss -> 409", async () => {
  const ok = fakeDb();
  const r1 = await handlePost(
    req({ radarId: RADAR_ID, externalId: "ext-1" }),
    depsFrom(ok.client),
  );
  assert.equal(r1.status, 201);
  const body1 = await r1.json();
  assert.equal(body1.item?.anchor, "listing");
  assert.equal(body1.item?.listing?.marketListingId, LISTING_ID);
  assert.equal(body1.item?.listing?.title, "Nhà X");
  assert.equal(body1.item?.listing?.priceVnd, 1e9);

  const rFake = await handlePost(
    req({ radarId: RADAR_ID, externalId: "ext-lạ" }),
    depsFrom(ok.client),
  );
  assert.equal(rFake.status, 404);

  const r404 = await handlePost(
    req({ radarId: "99999999-0000-4000-8000-999999999999", externalId: "ext-1" }),
    depsFrom(ok.client),
  );
  assert.equal(r404.status, 404);

  // 409: radar match có nhưng market_listing miss
  const adminClientNoListing = {
    from: (t: string) => {
      const chain = (tbl: string) => ({
        select: () => chain(tbl),
        eq: () => chain(tbl),
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
      });
      return chain(t);
    },
  };
  const deps = depsFrom(ok.client);
  deps.adminClient = () => adminClientNoListing as unknown as SupabaseClient;
  const r409 = await handlePost(
    req({ radarId: RADAR_ID, externalId: "ext-1" }),
    deps,
  );
  assert.equal(r409.status, 409);
  const body409 = await r409.json();
  assert.equal(body409.error, "Không resolve được tin gốc");
});

await check("POST idempotent: check trùng -> duplicate:true, không insert mới", async () => {
  const { client, inserts } = fakeDb({ checkOwned: true, items: [] });
  const r1 = await handlePost(req({ checkId: CHECK_ID }), depsFrom(client));
  assert.equal(r1.status, 201);
  const before = inserts.length;
  const r2 = await handlePost(req({ checkId: CHECK_ID }), depsFrom(client));
  const body = await r2.json();
  assert.equal(r2.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(inserts.length - before, 1); // insert attempt nhưng DB unique chặn
});

await check("PATCH: status/note OK; trả full check detail; status cũ từ chối; anchor field từ chối; updated_at từ chối", async () => {
  const { client } = fakeDb();
  const ok = await handlePatch(
    { params: Promise.resolve({ id: ITEM_ID }) },
    req({ status: "da_goi", note: " gọi sớm " }),
    depsFrom(client),
  );
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.item?.status, "da_goi");
  assert.equal(body.item?.note, "gọi sớm");
  assert.equal(body.item?.anchor, "check");
  assert.equal(body.item?.check?.score, 82);
  assert.equal(body.item?.check?.isNgoP, 18);

  const badStatus = await handlePatch(
    { params: Promise.resolve({ id: ITEM_ID }) },
    req({ status: "chot" }),
    depsFrom(client),
  );
  assert.equal(badStatus.status, 400);
  const badAnchor = await handlePatch(
    { params: Promise.resolve({ id: ITEM_ID }) },
    req({ status: "da_goi", check_id: "x" }),
    depsFrom(client),
  );
  assert.equal(badAnchor.status, 400);
  const badUpdated = await handlePatch(
    { params: Promise.resolve({ id: ITEM_ID }) },
    req({ status: "da_goi", updated_at: "2026-01-01" }),
    depsFrom(client),
  );
  assert.equal(badUpdated.status, 400);
});

await check("PATCH malformed id -> 400", async () => {
  const { client } = fakeDb();
  const r = await handlePatch(
    { params: Promise.resolve({ id: "not-a-uuid" }) },
    req({ status: "da_goi" }),
    depsFrom(client),
  );
  assert.equal(r.status, 400);
});

await check("DELETE malformed id -> 400", async () => {
  const { client } = fakeDb();
  const r = await handleDelete(
    { params: Promise.resolve({ id: "not-a-uuid" }) },
    depsFrom(client),
  );
  assert.equal(r.status, 400);
});

await check("PATCH id không thuộc user -> 404", async () => {
  const { client } = fakeDb();
  const r = await handlePatch(
    { params: Promise.resolve({ id: OTHER_ITEM_ID }) },
    req({ status: "da_goi" }),
    depsFrom(client),
  );
  assert.equal(r.status, 404);
});

await check("DELETE: own -> 200; foreign -> 404", async () => {
  const { client } = fakeDb();
  const ok = await handleDelete(
    { params: Promise.resolve({ id: ITEM_ID }) },
    depsFrom(client),
  );
  assert.equal(ok.status, 200);
  const foreign = await handleDelete(
    { params: Promise.resolve({ id: OTHER_ITEM_ID }) },
    depsFrom(client),
  );
  assert.equal(foreign.status, 404);
});

await check("DB exception -> controlled JSON 500", async () => {
  const { client } = fakeDb({ queryError: { table: "checks", code: "22P02", msg: "invalid uuid" } });
  const res = await handleGet(depsFrom(client));
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error, "Lỗi hệ thống");
});

await check("foreign check anchor POST -> 404", async () => {
  const foreign = fakeDb({ checkOwned: false });
  const r = await handlePost(
    req({ checkId: CHECK_ID }),
    depsFrom(foreign.client),
  );
  assert.equal(r.status, 404);
});

await check("QUOTA INVARIANT: handlers/route không import /api/check, AI, quota", () => {
  const files = [
    "lib/watchlist/handlers.ts",
    "app/api/watchlist/route.ts",
    "app/api/watchlist/[id]/route.ts",
  ];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const imports = src.split("\n").filter((l) => /^\s*(import|export) .*\bfrom\b/.test(l));
    assert.ok(!imports.some((l) => /\/api\/check\b/.test(l)), `${f} không import /api/check`);
    assert.ok(
      !imports.some((l) => /\b(jev|pro-analysis|scoring|analyzeListing|jev-check|getQuota|planLimit|credits)\b/i.test(l)),
      `${f} không import AI/quota`,
    );
  }
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
