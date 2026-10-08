// Self-check: validate watchlist — status canonical, note, XOR anchor, PATCH.
// Chạy: npm test
import { strict as assert } from "node:assert";
import {
  WATCHLIST_STATUSES,
  WATCHLIST_STATUS_LABEL,
} from "../lib/watchlist/types.ts";
import {
  validateWatchlistCreate,
  validateWatchlistPatch,
} from "../lib/watchlist/validate.ts";

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

const CHECK_ID = "11111111-2222-4333-8444-555555555555";
const LISTING_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

check("đúng 5 status canonical, đủ label", () => {
  assert.deepEqual(
    [...WATCHLIST_STATUSES],
    ["moi_luu", "can_goi", "da_goi", "dang_theo", "bo_qua"],
  );
  for (const s of WATCHLIST_STATUSES) assert.ok(WATCHLIST_STATUS_LABEL[s], `thiếu label ${s}`);
});

check("status cũ bị từ chối: da_lien_he / da_xem / chot", () => {
  for (const legacy of ["da_lien_he", "da_xem", "chot"]) {
    const r = validateWatchlistCreate({ checkId: CHECK_ID, status: legacy });
    assert.equal(r.ok, false, `phải từ chối ${legacy}`);
    assert.ok(r.errors.status, `phải báo lỗi status cho ${legacy}`);
  }
});

check("status thiếu -> mặc định moi_luu; sai -> từ chối, không âm thầm mặc định", () => {
  const r = validateWatchlistCreate({ checkId: CHECK_ID });
  assert.equal(r.ok, true);
  assert.equal(r.value?.status, "moi_luu");
  const bad = validateWatchlistCreate({ checkId: CHECK_ID, status: "moi_luu " });
  assert.equal(bad.ok, false, "chuỗi có khoảng trắng không phải status canonical");
  const bad2 = validateWatchlistCreate({ checkId: CHECK_ID, status: 42 });
  assert.equal(bad2.ok, false);
});

check("XOR anchor: chỉ checkId OK, chỉ marketListingId OK", () => {
  const a = validateWatchlistCreate({ checkId: CHECK_ID });
  assert.equal(a.ok, true);
  assert.deepEqual(a.value?.anchor, { kind: "check", checkId: CHECK_ID });

  const b = validateWatchlistCreate({ marketListingId: LISTING_ID });
  assert.equal(b.ok, true);
  assert.deepEqual(b.value?.anchor, { kind: "listing", marketListingId: LISTING_ID });
});

check("XOR anchor: cả hai hoặc không cái nào -> từ chối", () => {
  const both = validateWatchlistCreate({ checkId: CHECK_ID, marketListingId: LISTING_ID });
  assert.equal(both.ok, false);
  assert.ok(both.errors.anchor);

  const neither = validateWatchlistCreate({});
  assert.equal(neither.ok, false);
  assert.ok(neither.errors.anchor);
});

check("anchor không phải UUID -> từ chối", () => {
  const r = validateWatchlistCreate({ checkId: "not-a-uuid" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.anchor);
  const r2 = validateWatchlistCreate({ marketListingId: "123" });
  assert.equal(r2.ok, false);
});

check("note: 500 ký tự OK, 501 từ chối; rỗng -> null", () => {
  const ok = validateWatchlistCreate({ checkId: CHECK_ID, note: "a".repeat(500) });
  assert.equal(ok.ok, true);
  assert.equal(ok.value?.note?.length, 500);

  const tooLong = validateWatchlistCreate({ checkId: CHECK_ID, note: "a".repeat(501) });
  assert.equal(tooLong.ok, false);
  assert.ok(tooLong.errors.note);

  const empty = validateWatchlistCreate({ checkId: CHECK_ID, note: "   " });
  assert.equal(empty.ok, true);
  assert.equal(empty.value?.note, null, "note rỗng phải chuẩn hoá về null");

  const trimmed = validateWatchlistCreate({ checkId: CHECK_ID, note: "  gọi lại  " });
  assert.equal(trimmed.value?.note, "gọi lại");

  const bad = validateWatchlistCreate({ checkId: CHECK_ID, note: 123 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.note);
});

check("PATCH: status/note OK; note rỗng -> null", () => {
  const s = validateWatchlistPatch({ status: "da_goi" });
  assert.equal(s.ok, true);
  assert.equal(s.value?.status, "da_goi");

  const n = validateWatchlistPatch({ note: "" });
  assert.equal(n.ok, true);
  assert.equal(n.value?.note, null);

  const both = validateWatchlistPatch({ status: "bo_qua", note: "không phù hợp" });
  assert.equal(both.ok, true);
  assert.equal(both.value?.status, "bo_qua");
  assert.equal(both.value?.note, "không phù hợp");
});

check("PATCH: reject mọi anchor/snapshot field", () => {
  for (const key of [
    "check_id",
    "checkId",
    "market_listing_id",
    "marketListingId",
    "user_id",
    "created_at",
    "listing_title",
    "listing_url",
    "listing_price_vnd",
    "listing_size_m2",
    "listing_area_name",
    "listing_region_name",
  ]) {
    const r = validateWatchlistPatch({ status: "da_goi", [key]: "x" });
    assert.equal(r.ok, false, `PATCH phải từ chối field ${key}`);
    assert.ok(r.errors.patch, `phải báo lỗi patch cho ${key}`);
  }
});

check("PATCH: không có field hợp lệ -> từ chối; status sai -> từ chối", () => {
  const empty = validateWatchlistPatch({});
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.patch);

  const legacy = validateWatchlistPatch({ status: "chot" });
  assert.equal(legacy.ok, false);
  assert.ok(legacy.errors.status);

  const longNote = validateWatchlistPatch({ note: "a".repeat(501) });
  assert.equal(longNote.ok, false);
  assert.ok(longNote.errors.note);
});

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exitCode = fail > 0 ? 1 : 0;
