// Self-check: ghi địa lý cho check — backward compatible khi thiếu migration 0014.
// Chạy: npm test — fake admin client, không DB.
import { strict as assert } from "node:assert";
import { hasCheckGeo, persistCheckGeo, type CheckGeo } from "../lib/check-geo.ts";

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

/** Fake admin: cho phép cấu hình trả error hoặc throw. */
function fakeAdmin(opts: { error?: { code?: string; message?: string }; throws?: unknown; captured?: Captured }) {
  const chain: Record<string, unknown> = {
    update(payload: Record<string, unknown>) {
      if (opts.captured) opts.captured.payload = payload;
      const self: Record<string, unknown> = {
        eq: () => self,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(resolve(opts.error ? { data: null, error: opts.error } : { data: null, error: null })),
      };
      return self;
    },
  };
  return {
    from: () => {
      if (opts.throws) throw opts.throws;
      return chain;
    },
  } as never;
}

async function main() {
  console.log("\n== Không có địa lý -> không gọi DB ==");

  await check("geo rỗng -> skipped, không chạm DB", async () => {
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

  await check("hasCheckGeo chỉ true khi có ward hoặc region", () => {
    assert.equal(hasCheckGeo(GEO_SCAN), true);
    assert.equal(
      hasCheckGeo({ ward_name: null, region_name: "Vũng Tàu", ward_source: null, region_source: "scan" }),
      true,
    );
    assert.equal(hasCheckGeo({ ward_name: null, region_name: null, ward_source: null, region_source: null }), false);
  });

  console.log("\n== Migration ĐÃ có cột geo -> lưu đầy đủ ==");

  await check("ghi đủ 4 cột + nguồn", async () => {
    const captured: Captured = { payload: null };
    const r = await persistCheckGeo(fakeAdmin({ captured }), "chk1", GEO_SCAN);
    assert.deepEqual(r, { ok: true, skipped: false });
    assert.deepEqual(captured.payload, {
      ward_name: "Quận 6",
      region_name: "Tp Hồ Chí Minh",
      ward_source: "scan",
      region_source: "scan",
    });
  });

  await check("chỉ có region vẫn ghi, source null cho phần không xác định", async () => {
    const captured: Captured = { payload: null };
    const geo: CheckGeo = {
      ward_name: null,
      region_name: "Vũng Tàu",
      ward_source: null,
      region_source: "scan",
    };
    await persistCheckGeo(fakeAdmin({ captured }), "chk1", geo);
    assert.equal(captured.payload!.ward_name, null);
    assert.equal(captured.payload!.ward_source, null);
    assert.equal(captured.payload!.region_name, "Vũng Tàu");
  });

  console.log("\n== Migration CHƯA có cột geo -> check vẫn tạo được ==");

  await check("cột chưa có (42703) -> ok:false + schema_missing, KHÔNG throw", async () => {
    const r = await persistCheckGeo(
      fakeAdmin({ error: { code: "42703", message: 'column "ward_name" does not exist' } }),
      "chk1",
      GEO_SCAN,
    );
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.errorCode, "schema_missing");
  });

  await check("PostgREST PGRST204 -> schema_missing", async () => {
    const r = await persistCheckGeo(fakeAdmin({ error: { code: "PGRST204" } }), "chk1", GEO_SCAN);
    assert.equal(r.ok === false && r.errorCode, "schema_missing");
  });

  await check("RLS (42501) -> rls_denied, không throw", async () => {
    const r = await persistCheckGeo(fakeAdmin({ error: { code: "42501" } }), "chk1", GEO_SCAN);
    assert.equal(r.ok === false && r.errorCode, "rls_denied");
  });

  console.log("\n== Lỗi bất ngờ -> vẫn soft, không throw ra ngoài ==");

  await check("from() ném lỗi -> trả về lỗi, không throw", async () => {
    const r = await persistCheckGeo(fakeAdmin({ throws: new Error("service role key sai") }), "chk1", GEO_SCAN);
    assert.equal(r.ok, false);
  });

  await check("error code lạ -> unknown, không lộ message", async () => {
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
