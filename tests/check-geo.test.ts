// Self-check: ghi địa lý cho check — backward compatible khi thiếu migration 0014,
// và KHÔNG ghi đè địa lý đã có.
// Chạy: npm test — fake admin client, không DB.
import { strict as assert } from "node:assert";
import { hasCheckGeo, persistCheckGeo, type CheckGeo } from "../lib/check-geo.ts";
import { resolveListingGeo } from "../lib/geo/url-parser.ts";

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

const GEO_SCAN: CheckGeo = {
  ward_name: "Quận 6",
  region_name: "Tp Hồ Chí Minh",
  ward_source: "scan",
  region_source: "scan",
};

interface Captured {
  payload: Record<string, unknown> | null;
}

interface Existing {
  ward_name: string | null;
  region_name: string | null;
}

interface FakeOpts {
  /** Lỗi trả về cho CẢ đọc lẫn ghi (mô phỏng cột chưa tồn tại, RLS...). */
  error?: { code?: string; message?: string };
  /** from() ném lỗi ngay. */
  throws?: unknown;
  captured?: Captured;
  /** Geo đang có sẵn trong DB. null = dòng chưa tồn tại. */
  existing?: Existing | null;
  /** Mọi payload UPDATE đã gửi — dùng để chứng minh KHÔNG ghi khi đã đầy. */
  updates?: Record<string, unknown>[];
  /** Các filter .or() đã dùng. */
  orFilters?: string[];
  /** Ném lỗi riêng cho bước ghi, sau khi đọc thành công. */
  writeError?: { code?: string; message?: string };
}

/** Fake admin: mô phỏng select().eq().maybeSingle() rồi update().eq().or(). */
function fakeAdmin(opts: FakeOpts) {
  const state = { op: "update" as "select" | "update" };
  const chain: Record<string, unknown> = {};

  chain.select = () => {
    state.op = "select";
    return chain;
  };
  chain.update = (payload: Record<string, unknown>) => {
    state.op = "update";
    if (opts.captured) opts.captured.payload = payload;
    if (opts.updates) opts.updates.push(payload);
    return chain;
  };
  chain.eq = () => chain;
  chain.or = (f: string) => {
    if (opts.orFilters) opts.orFilters.push(f);
    return chain;
  };
  chain.maybeSingle = () => Promise.resolve({ data: opts.existing ?? null, error: null });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(
      resolve(
        state.op === "select"
          ? { data: opts.existing ?? null, error: opts.error ?? null }
          : { data: null, error: opts.writeError ?? opts.error ?? null },
      ),
    );

  return {
    from: () => {
      if (opts.throws) throw opts.throws;
      return chain;
    },
  } as never;
}

const EMPTY_ROW: Existing = { ward_name: null, region_name: null };

async function main() {
  // ------------------------------------------------------------------
  // A. Category scan gửi ward/region -> /api/check nhận được geo
  // ------------------------------------------------------------------
  console.log("\n== A. Category scan → resolveListingGeo (đúng key body của /api/check) ==");

  await check("scan gửi ward='Phường 11', region='Vũng Tàu' -> nhận đủ, source='scan'", () => {
    // Đúng 2 key mà components/dashboard/category-scan.tsx gửi, đúng như
    // app/api/check/route.ts đọc: resolveListingGeo({ scanWard: body?.ward, ... })
    const geo = resolveListingGeo({
      scanWard: "Phường 11",
      scanRegion: "Vũng Tàu",
    });
    assert.equal(geo.ward_name, "Phường 11");
    assert.equal(geo.region_name, "Vũng Tàu");
    assert.equal(geo.ward_source, "scan");
    assert.equal(geo.region_source, "scan");
    assert.equal(hasCheckGeo(geo), true, "phải đủ điều kiện để ghi DB");
  });

  await check("scan thiếu ward (chỉ có region) -> vẫn nhận region, không đoán ward", () => {
    const geo = resolveListingGeo({ scanWard: null, scanRegion: "Vũng Tàu" });
    assert.equal(geo.ward_name, null, "không được bịa ward");
    assert.equal(geo.region_name, "Vũng Tàu");
    assert.equal(geo.ward_source, null);
    assert.equal(hasCheckGeo(geo), true);
  });

  await check("A -> E2E: geo của scan đi thẳng vào persistCheckGeo và được ghi", async () => {
    const geo = resolveListingGeo({ scanWard: "Phường 11", scanRegion: "Vũng Tàu" });
    const updates: Record<string, unknown>[] = [];
    const r = await persistCheckGeo(
      fakeAdmin({ existing: EMPTY_ROW, updates }),
      "chk1",
      geo,
    );
    assert.deepEqual(r, { ok: true, skipped: false });
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0], {
      ward_name: "Phường 11",
      ward_source: "scan",
      region_name: "Vũng Tàu",
      region_source: "scan",
    });
  });

  // ------------------------------------------------------------------
  // B. persistCheckGeo: chỉ ghi khi ô trống, không overwrite
  // ------------------------------------------------------------------
  console.log("\n== B. persistCheckGeo không ghi đè ==");

  await check("B1. check chưa có geo -> ghi thành công", async () => {
    const updates: Record<string, unknown>[] = [];
    const r = await persistCheckGeo(fakeAdmin({ existing: EMPTY_ROW, updates }), "chk1", GEO_SCAN);
    assert.deepEqual(r, { ok: true, skipped: false });
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0], {
      ward_name: "Quận 6",
      ward_source: "scan",
      region_name: "Tp Hồ Chí Minh",
      region_source: "scan",
    });
  });

  await check("B2. check ĐÃ có geo -> không overwrite, không gọi UPDATE", async () => {
    const updates: Record<string, unknown>[] = [];
    const r = await persistCheckGeo(
      fakeAdmin({
        existing: { ward_name: "Phường 11", region_name: "Vũng Tàu" },
        updates,
      }),
      "chk1",
      GEO_SCAN,
    );
    assert.deepEqual(r, { ok: true, skipped: true }, "phải skip vì đã đầy đủ");
    assert.equal(updates.length, 0, "KHÔNG được gửi UPDATE khi geo đã có");
  });

  await check("B3. có ward, thiếu region -> chỉ điền region, GIỮ NGUYÊN ward", async () => {
    const updates: Record<string, unknown>[] = [];
    const r = await persistCheckGeo(
      fakeAdmin({ existing: { ward_name: "Phường 11", region_name: null }, updates }),
      "chk1",
      GEO_SCAN,
    );
    assert.deepEqual(r, { ok: true, skipped: false });
    assert.equal(updates.length, 1);
    assert.equal(updates[0].region_name, "Tp Hồ Chí Minh");
    assert.equal(updates[0].region_source, "scan");
    assert.ok(!("ward_name" in updates[0]), "ward đã có thì KHÔNG được gửi lại ward_name");
    assert.ok(!("ward_source" in updates[0]), "không được gửi lại ward_source");
  });

  await check("B4. có region, thiếu ward -> chỉ điền ward, GIỮ NGUYÊN region", async () => {
    const updates: Record<string, unknown>[] = [];
    const r = await persistCheckGeo(
      fakeAdmin({ existing: { ward_name: null, region_name: "Vũng Tàu" }, updates }),
      "chk1",
      GEO_SCAN,
    );
    assert.deepEqual(r, { ok: true, skipped: false });
    assert.equal(updates[0].ward_name, "Quận 6");
    assert.ok(!("region_name" in updates[0]), "region đã có thì KHÔNG được gửi lại");
  });

  await check("B5. UPDATE kèm điều kiện chống ghi đè ở mức dòng", async () => {
    const orFilters: string[] = [];
    await persistCheckGeo(fakeAdmin({ existing: EMPTY_ROW, orFilters }), "chk1", GEO_SCAN);
    assert.equal(orFilters.length, 1, "phải có .or()");
    assert.match(
      orFilters[0],
      /ward_name\.is\.null/,
      "phải chỉ ghi khi ward_name hoặc region_name đang NULL",
    );
    assert.match(orFilters[0], /region_name\.is\.null/);
  });

  await check("B6. dòng không tồn tại -> vẫn soft, không throw", async () => {
    const r = await persistCheckGeo(fakeAdmin({ existing: null }), "chk-missing", GEO_SCAN);
    assert.equal(r.ok, true, "không được throw vì dòng lạ");
  });

  // ------------------------------------------------------------------
  // C. Geo lỗi / thiếu field -> check vẫn tạo bình thường
  // ------------------------------------------------------------------
  console.log("\n== C. Geo lỗi hoặc thiếu -> không throw, check vẫn tạo được ==");

  await check("C1. geo rỗng -> skipped, không chạm DB", async () => {
    let called = false;
    const admin = {
      from: () => {
        called = true;
        throw new Error("không được gọi");
      },
    } as never;
    const r = await persistCheckGeo(admin, "chk1", {
      ward_name: null,
      region_name: null,
      ward_source: null,
      region_source: null,
    });
    assert.deepEqual(r, { ok: true, skipped: true });
    assert.equal(called, false, "không được gọi DB khi không có geo");
  });

  await check("C2. scan không trả ward/region -> không ghi, không throw", async () => {
    // category-scan item thiếu geo -> resolveListingGeo trả all-null
    const geo = resolveListingGeo({ scanWard: null, scanRegion: null });
    const updates: Record<string, unknown>[] = [];
    const r = await persistCheckGeo(fakeAdmin({ existing: EMPTY_ROW, updates }), "chk1", geo);
    assert.deepEqual(r, { ok: true, skipped: true });
    assert.equal(updates.length, 0);
  });

  await check("C3. chỉ có region trong geo -> không gửi ward=null (không xoá ward cũ)", async () => {
    const updates: Record<string, unknown>[] = [];
    const r = await persistCheckGeo(fakeAdmin({ existing: EMPTY_ROW, updates }), "chk1", {
      ward_name: null,
      region_name: "Vũng Tàu",
      ward_source: null,
      region_source: "scan",
    });
    assert.deepEqual(r, { ok: true, skipped: false });
    assert.equal(updates[0].region_name, "Vũng Tàu");
    assert.ok(!("ward_name" in updates[0]), "không được gửi ward_name=null — sẽ xoá ward đang có");
  });

  await check("hasCheckGeo chỉ true khi có ward hoặc region", () => {
    assert.equal(hasCheckGeo(GEO_SCAN), true);
    assert.equal(
      hasCheckGeo({ ward_name: null, region_name: "Vũng Tàu", ward_source: null, region_source: "scan" }),
      true,
    );
    assert.equal(hasCheckGeo({ ward_name: null, region_name: null, ward_source: null, region_source: null }), false);
  });

  await check("C4. cột chưa có (42703) -> schema_missing, KHÔNG throw", async () => {
    const r = await persistCheckGeo(
      fakeAdmin({ error: { code: "42703", message: 'column "ward_name" does not exist' } }),
      "chk1",
      GEO_SCAN,
    );
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.errorCode, "schema_missing");
  });

  await check("C5. PostgREST PGRST204 -> schema_missing", async () => {
    const r = await persistCheckGeo(fakeAdmin({ error: { code: "PGRST204" } }), "chk1", GEO_SCAN);
    assert.equal(r.ok === false && r.errorCode, "schema_missing");
  });

  await check("C6. RLS (42501) -> rls_denied, không throw", async () => {
    const r = await persistCheckGeo(fakeAdmin({ error: { code: "42501" } }), "chk1", GEO_SCAN);
    assert.equal(r.ok === false && r.errorCode, "rls_denied");
  });

  await check("C7. lỗi ở bước GHI (đọc OK) -> vẫn soft, không throw", async () => {
    const r = await persistCheckGeo(
      fakeAdmin({ existing: EMPTY_ROW, writeError: { code: "42501" } }),
      "chk1",
      GEO_SCAN,
    );
    assert.equal(r.ok, false, "báo lỗi thay vì im lặng báo thành công");
    assert.equal(r.ok === false && r.errorCode, "rls_denied");
  });

  await check("C8. from() ném lỗi -> trả về lỗi, không throw ra ngoài", async () => {
    const r = await persistCheckGeo(fakeAdmin({ throws: new Error("service role key sai") }), "chk1", GEO_SCAN);
    assert.equal(r.ok, false);
  });

  await check("C9. error code lạ -> unknown, không lộ message", async () => {
    const r = await persistCheckGeo(
      fakeAdmin({ error: { code: "XX999", message: "chi tiết nhạy cảm" } }),
      "chk1",
      GEO_SCAN,
    );
    assert.equal(r.ok === false && r.errorCode, "unknown");
    assert.ok(!JSON.stringify(r).includes("nhạy cảm"), "không được lộ message gốc");
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
