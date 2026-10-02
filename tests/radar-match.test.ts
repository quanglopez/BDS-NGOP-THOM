import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signalLabels } from "@/lib/radar/format";
import { getRadarMatches, scanRadar } from "@/lib/radar/data";
import type { RadarMatch, RadarSummary } from "@/lib/radar/types";

const base: RadarMatch = {
  externalId: "radar-test",
  url: null,
  title: null,
  areaName: null,
  regionName: null,
  categoryCode: null,
  priceVnd: null,
  sizeM2: null,
  pricePerM2: null,
  listedAt: null,
  lastSeenAt: null,
  score: null,
  dealType: null,
  isNgoP: null,
  scoringAvailable: false,
  comparison: null,
  firstMatchedAt: "2026-10-02T00:00:00Z",
  lastMatchedAt: "2026-10-02T00:00:00Z",
  currentMatch: false,
};

assert.deepEqual(signalLabels(base), []);
assert.deepEqual(
  signalLabels({
    ...base,
    comparison: {
      medianPpm2: 1,
      differencePercent: -12,
      confidence: "low",
      scopeDescription: "x",
    },
  }),
  ["Giá thấp hơn tham chiếu 12%", "Độ tin cậy tham chiếu: Thấp"],
);

const zeroScore: RadarMatch = { ...base, score: 0 };
assert.equal(zeroScore.score, 0);

// ---------------------------------------------------------------- fake DB

type Row = Record<string, unknown>;
type Filter = [op: string, col: string, val: unknown];

interface UpsertCall {
  table: string;
  rows: Row[];
  onConflict?: string;
}

/** Supabase client tối thiểu cho `scanRadar`/`getRadarMatches`: 10 method mà
 *  hai hàm đó dùng (select/eq/gte/lte/not/in/order/limit/upsert/update).
 *  `gte`/`lte` chưa fixture nào chạm tới nhưng giữ lại để fake không phụ thuộc
 *  việc Radar hiện có đặt khoảng giá/diện tích hay không.
 *  `failures` ép lỗi từng bảng/từng op để test failure path; `fromCalls` đếm
 *  số query mỗi bảng để chứng minh batch lookup (không N+1). */
function fakeDb(
  tables: Record<string, Row[]>,
  failures: { table: string; op: "select" | "upsert" }[] = [],
) {
  const upserts: UpsertCall[] = [];
  const updates: { table: string; patch: Row }[] = [];
  const fromCalls: Record<string, number> = {};
  const store = (t: string): Row[] => (tables[t] ??= []);
  const forced = (table: string, op: "select" | "upsert") =>
    failures.some((f) => f.table === table && f.op === op)
      ? { code: "XX000", message: `forced_${op}_failure` }
      : null;

  function from(table: string) {
    fromCalls[table] = (fromCalls[table] ?? 0) + 1;
    const filters: Filter[] = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let take = Infinity;
    let wantsCount = false;
    let pending: Row | null = null;
    const match = (r: Row) =>
      filters.every(([op, c, v]) => {
        if (op === "eq") return r[c] === v;
        if (op === "gte") return Number(r[c]) >= Number(v);
        if (op === "lte") return Number(r[c]) <= Number(v);
        if (op === "not") return r[c] !== null && r[c] !== undefined;
        if (op === "in") return Array.isArray(v) && v.includes(r[c]);
        return true;
      });
    const rows = () => {
      let out = store(table).filter(match);
      if (orderCol) {
        const dir = orderAsc ? 1 : -1;
        const col = orderCol;
        out = [...out].sort((a, b) =>
          String(a[col]) === String(b[col]) ? 0 : String(a[col]) < String(b[col]) ? -dir : dir,
        );
      }
      return out.slice(0, take);
    };
    const api = {
      select(_cols?: string, opts?: { count?: string }) {
        wantsCount = opts?.count === "exact";
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push(["eq", col, val]);
        return api;
      },
      gte(col: string, val: unknown) {
        filters.push(["gte", col, val]);
        return api;
      },
      lte(col: string, val: unknown) {
        filters.push(["lte", col, val]);
        return api;
      },
      not(col: string, _op: string, val: unknown) {
        filters.push(["not", col, val]);
        return api;
      },
      in(col: string, val: unknown) {
        filters.push(["in", col, val]);
        return api;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAsc = opts?.ascending ?? true;
        return api;
      },
      limit(n?: number) {
        take = n ?? Infinity;
        return api;
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        const forcedError = forced(table, "select");
        if (forcedError) return Promise.resolve({ data: null, error: forcedError }).then(resolve, reject);
        if (pending) {
          for (const r of store(table)) if (match(r)) Object.assign(r, pending);
          pending = null;
        }
        const out = rows();
        return Promise.resolve({ data: out, error: null, count: wantsCount ? out.length : null }).then(
          resolve,
          reject,
        );
      },
      async upsert(payload: Row[], opts?: { onConflict?: string }) {
        const forcedError = forced(table, "upsert");
        if (forcedError) return { data: null, error: forcedError };
        upserts.push({ table, rows: payload, onConflict: opts?.onConflict });
        const cur = store(table);
        for (const row of payload) {
          // Khoá so khớp hardcode (radar_id, external_id) khớp `onConflict` mà
          // production truyền vào; test khẳng định giá trị đó ở trên.
          const i = cur.findIndex(
            (x) => String(x.external_id) === String(row.external_id) && String(x.radar_id ?? "") === String(row.radar_id ?? ""),
          );
          if (i >= 0) cur[i] = { ...cur[i], ...row };
          else cur.push({ ...row });
        }
        return { data: null, error: null };
      },
      update(patch: Row) {
        updates.push({ table, patch });
        pending = patch;
        return api;
      },
    };
    return api;
  }

  return { db: { from } as unknown as SupabaseClient, upserts, updates, tables, fromCalls };
}

const listing = (id: string, lastSeen: string): Row => ({
  external_id: id,
  url: `/tin/${id}.htm`,
  title: `Tin ${id}`,
  area_name: "Quận 6",
  region_name: "Tp Hồ Chí Minh",
  category_code: 1000,
  price_vnd: 5_000_000_000,
  size_m2: 50,
  price_per_m2: 100_000_000,
  listed_at: "2026-10-01T00:00:00Z",
  last_seen_at: lastSeen,
  rooms: 3,
  area_v2: 13006,
  is_rent: false,
  is_promoted: false,
  is_price_valid: true,
});

const check_ = (id: string, over: Row): Row => ({
  listing_url: `https://checkbds.vn/check/cho-thue-nha-dat-${id}.htm`,
  score: null,
  deal_type: null,
  is_ngop: null,
  created_at: "2026-10-01T00:00:00Z",
  ...over,
});

/** 111 chấm điểm cao, 222 chấm 0 điểm (bẫy falsy), 333 chưa từng chấm. */
function seed() {
  return fakeDb({
    market_listings: [
      listing("111", "2026-10-02T09:00:00Z"),
      listing("222", "2026-10-02T08:00:00Z"),
      listing("333", "2026-10-02T07:00:00Z"),
    ],
    checks: [
      check_("111", { score: 82, deal_type: "ngop_ngon", is_ngop: 88 }),
      check_("222", { score: 0, deal_type: null, is_ngop: 12 }),
      // Check cũ của 111 bị đè bởi Check mới hơn -> phải lấy 82, không lấy 40.
      check_("111", { score: 40, deal_type: "binh_thuong", is_ngop: 10, created_at: "2026-09-01T00:00:00Z" }),
    ],
    radar_matches: [],
    radars: [{ id: "radar-1" }],
  });
}

const RADAR: RadarSummary = {
  id: "radar-1",
  name: "Radar Quận 6",
  areaV2: 13006,
  areaName: "Quận 6",
  regionName: "Tp Hồ Chí Minh",
  categoryCode: null,
  priceMinVnd: null,
  priceMaxVnd: null,
  areaMinM2: null,
  areaMaxM2: null,
  minScore: null,
  dealTypes: [],
  ngoPOnly: false,
  status: "ACTIVE",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  coverage: {
    status: "unknown",
    lastSeenAt: null,
    freshness: null,
    staleness: "unknown",
    listingCount: null,
    checkedAt: null,
    source: "chotot_gateway",
    description: null,
    excludedCount: null,
  },
  newMatchCount: 0,
  lastScanCount: null,
  lastScanError: null,
};

const byId = (rows: Row[], id: string) => {
  const hit = rows.find((r) => r.external_id === id);
  assert.ok(hit, `thiếu dòng ${id}`);
  return hit!;
};

// ---------------------------------------------------------------- scanRadar

// Tin chưa chấm phải được ghi xuống y hệt tin đã chấm: null + scoring_available=false.
{
  const { db, upserts, updates, tables } = seed();
  const res = await scanRadar(db, RADAR);

  const call = upserts.find((u) => u.table === "radar_matches");
  assert.ok(call, "phải upsert vào radar_matches");
  assert.equal(call.onConflict, "radar_id,external_id", "phải khoá theo (radar_id, external_id)");
  assert.equal(call.rows.length, 3, "cả 3 tin đều phải được ghi, kể cả tin chưa chấm");

  const scored = byId(call.rows, "111");
  assert.equal(scored.score, 82, "phải lấy Check MỚI NHẤT (82), không phải Check cũ (40)");
  assert.equal(scored.deal_type, "ngop_ngon");
  assert.equal(scored.is_ngop, 88);
  assert.equal(scored.scoring_available, true);

  // Bẫy falsy: score = 0 là điểm thật, không phải "chưa chấm".
  const zero = byId(call.rows, "222");
  assert.equal(zero.score, 0, "score 0 phải giữ nguyên 0, không được đổi thành null");
  assert.equal(zero.scoring_available, true, "có Check dù 0 điểm thì scoring_available = true");
  assert.equal(zero.deal_type, null);
  assert.equal(zero.is_ngop, 12);

  const unscored = byId(call.rows, "333");
  assert.equal(unscored.score, null, "tin chưa chấm: score phải null, tuyệt đối không phải 0");
  assert.equal(unscored.deal_type, null);
  assert.equal(unscored.is_ngop, null);
  assert.equal(unscored.scoring_available, false);

  assert.equal(res.newMatchCount, 3, "lần quét đầu: cả 3 tin đều là tin mới");
  assert.equal(res.matches.length, 3);

  const radarUpdate = updates.find((u) => u.table === "radars");
  assert.ok(radarUpdate, "phải cập nhật bảng radars");
  assert.equal(radarUpdate.patch.last_scan_count, 3, "tin chưa chấm vẫn phải được đếm");
  assert.equal(radarUpdate.patch.last_scan_error, null);

  assert.equal(tables.radar_matches.length, 3, "3 dòng phải nằm trong radar_matches");
}

// ------------------------------------------------------------ getRadarMatches

{
  const { db } = seed();
  await scanRadar(db, RADAR);
  const got = await getRadarMatches(db, RADAR);

  // Một lần quét gán CÙNG một `scanAt` cho mọi dòng, nên thứ tự ở đây không
  // chứng minh gì về `.order(...)` — chuyện đó ở khối seed bên dưới.
  assert.equal(got.length, 3, "phải trả về cả tin chưa chấm");
  assert.deepEqual(
    [...got].map((m: RadarMatch) => m.externalId).sort(),
    ["111", "222", "333"],
  );

  const scored = got.find((m: RadarMatch) => m.externalId === "111")!;
  assert.equal(scored.score, 82);
  assert.equal(scored.dealType, "ngop_ngon");
  assert.equal(scored.isNgoP, 88);
  assert.equal(scored.scoringAvailable, true);

  const zero = got.find((m: RadarMatch) => m.externalId === "222")!;
  assert.equal(zero.score, 0, "điểm 0 phải đọc lại được từ DB");
  assert.equal(zero.scoringAvailable, true);

  const unscored = got.find((m: RadarMatch) => m.externalId === "333")!;
  assert.equal(unscored.score, null);
  assert.equal(unscored.dealType, null);
  assert.equal(unscored.isNgoP, null);
  assert.equal(unscored.scoringAvailable, false);

  // 0 điểm KHÁC hoàn toàn với chưa chấm. Đây là chỗ bảo vệ bẫy falsy:
  // nếu ai đó gộp `score ?? 0` hoặc `Boolean(score)` thì hai dòng này trùng nhau.
  assert.notEqual(zero.score, unscored.score, "score 0 không được rơi về null như tin chưa chấm");
  assert.notEqual(
    zero.scoringAvailable,
    unscored.scoringAvailable,
    "0 điểm là ĐÃ chấm (true), chưa chấm là false",
  );

  // `signalLabels` chỉ đọc `comparison`. Nên "không có nhãn" phải được bảo vệ
  // bằng cả hai vế: không có comparison, VÀ không được tự chế nhãn từ điểm.
  assert.equal(unscored.comparison, null, "không có thống kê tham chiếu thì comparison phải null");
  assert.deepEqual(signalLabels(unscored), [], "tin chưa chấm: không được tạo nhãn giả");
  assert.equal(zero.comparison, null, "0 điểm cũng không có thống kê tham chiếu");
  assert.deepEqual(
    signalLabels(zero),
    [],
    "0 điểm không phải tín hiệu để hiện; KHÔNG được sinh nhãn từ score",
  );

  // Có thống kê thì nhãn vẫn phải hiện — chứng minh [] ở trên là do thiếu dữ
  // liệu chứ không phải do signalLabels bị chết.
  assert.deepEqual(
    signalLabels({
      ...unscored,
      score: 82,
      scoringAvailable: true,
      comparison: { medianPpm2: 1, differencePercent: -12, confidence: "low", scopeDescription: "x" },
    }),
    ["Giá thấp hơn tham chiếu 12%", "Độ tin cậy tham chiếu: Thấp"],
  );
}

/** Dòng `radar_matches` đã lưu, dùng để kiểm thứ tự đọc lại từ DB. */
const storedMatch = (id: string, lastMatchedAt: string): Row => ({
  radar_id: "radar-1",
  external_id: id,
  url: `/tin/${id}.htm`,
  title: `Tin ${id}`,
  area_name: "Quận 6",
  region_name: "Tp Hồ Chí Minh",
  category_code: 1000,
  price_vnd: 5_000_000_000,
  size_m2: 50,
  price_per_m2: 100_000_000,
  listed_at: "2026-10-01T00:00:00Z",
  last_seen_at: "2026-10-02T09:00:00Z",
  score: null,
  deal_type: null,
  is_ngop: null,
  scoring_available: false,
  median_ppm2: null,
  difference_percent: null,
  confidence: null,
  scope_description: null,
  first_matched_at: "2026-10-01T00:00:00Z",
  last_matched_at: lastMatchedAt,
});

// Thứ tự đọc: `last_matched_at` GIẢM DẦN (mới nhất trước).
// Seed cố ý nhét theo thứ tự TĂNG DẦN, nên assertion này chết nếu production
// đổi `.order("last_matched_at", { ascending: false })` sang `true`, hoặc bỏ hẳn.
{
  const { db } = fakeDb({
    radar_matches: [
      storedMatch("a", "2026-10-02T09:00:00Z"),
      storedMatch("b", "2026-10-02T10:00:00Z"),
      storedMatch("c", "2026-10-02T11:00:00Z"),
    ],
  });
  const got = await getRadarMatches(db, RADAR);
  assert.deepEqual(
    got.map((m: RadarMatch) => m.externalId),
    ["c", "b", "a"],
    "getRadarMatches phải trả tin vừa quét gần nhất trước",
  );
  assert.deepEqual(
    got.map((m: RadarMatch) => m.lastMatchedAt),
    ["2026-10-02T11:00:00Z", "2026-10-02T10:00:00Z", "2026-10-02T09:00:00Z"],
  );
}

// Quét lại: first_matched_at giữ nguyên, last_matched_at cập nhật.
{
  const { db } = seed();
  const first = await scanRadar(db, RADAR);
  const firstAt = first.matches.map((m: RadarMatch) => `${m.externalId}|${m.firstMatchedAt}`).join(",");
  const second = await scanRadar(db, RADAR);

  assert.deepEqual(
    second.matches.map((m: RadarMatch) => `${m.externalId}|${m.firstMatchedAt}`).join(","),
    firstAt,
    "quét lại không được đổi first_matched_at",
  );
  assert.equal(second.newMatchCount, 0, "quét lại không có tin mới nào");

  const stored = await getRadarMatches(db, RADAR);
  assert.equal(stored.length, 3, "upsert phải ghi đè, không nhân bản dòng");
}

// ---------------------------------------------- RESCAN: newest Check + clear stale
// Các block trên chỉ kiểm "Check mới nhất thắng trong MỘT lần quét". Ở đây mô
// phỏng vòng đời thật qua nhiều lần quét: Check cũ -> Check mới xuất hiện ->
// Check biến mất. Không được giữ signal cũ khi không còn Check hợp lệ.
{
  const { db, tables } = fakeDb({
    market_listings: [listing("111", "2026-10-02T09:00:00Z")],
    checks: [check_("111", { score: 40, deal_type: "binh_thuong", is_ngop: 10, created_at: "2026-09-01T00:00:00Z" })],
    radar_matches: [],
    radars: [{ id: "radar-1" }],
  });

  const first = await scanRadar(db, RADAR);
  assert.equal(first.matches[0]!.score, 40, "lần 1: dùng Check cũ");
  const firstAt = first.matches[0]!.firstMatchedAt;

  // Check mới hơn xuất hiện giữa hai lần quét.
  tables.checks.push(check_("111", { score: 90, deal_type: "ngop_ngon", is_ngop: 95, created_at: "2026-10-03T00:00:00Z" }));
  const second = await scanRadar(db, RADAR);
  assert.equal(second.matches[0]!.score, 90, "rescan: Check mới hơn phải thắng");
  assert.equal(second.matches[0]!.dealType, "ngop_ngon");
  assert.equal(second.matches[0]!.isNgoP, 95);
  assert.equal(second.matches[0]!.scoringAvailable, true);
  assert.equal(second.matches[0]!.firstMatchedAt, firstAt, "signal đổi không được reset first_matched_at");

  const afterSecond = await getRadarMatches(db, RADAR);
  assert.equal(afterSecond[0]!.score, 90, "DB phải bị ghi đè bởi signal mới, không giữ 40");

  // Không còn Check nào cho tin này (bị xoá / ngoài window).
  tables.checks = tables.checks.filter((c) => !String(c.listing_url).includes("111"));
  const third = await scanRadar(db, RADAR);
  assert.equal(third.matches[0]!.score, null, "mất Check -> score về null, KHÔNG giữ 90");
  assert.equal(third.matches[0]!.dealType, null);
  assert.equal(third.matches[0]!.isNgoP, null);
  assert.equal(third.matches[0]!.scoringAvailable, false);
  assert.equal(third.newMatchCount, 0, "mất signal không biến tin cũ thành tin mới");

  const afterThird = await getRadarMatches(db, RADAR);
  assert.equal(afterThird.length, 1, "tin KHÔNG bị mất khỏi radar_matches khi mất signal");
  assert.equal(afterThird[0]!.score, null, "stale score trong DB phải bị xoá");
  assert.equal(afterThird[0]!.dealType, null, "stale deal_type trong DB phải bị xoá");
  assert.equal(afterThird[0]!.isNgoP, null, "stale is_ngop trong DB phải bị xoá");
  assert.equal(afterThird[0]!.scoringAvailable, false);
}

// Batch signal lookup: 3 tin nhưng CHỈ 1 query bảng checks (không N+1).
{
  const { db, fromCalls } = seed();
  await scanRadar(db, RADAR);
  assert.equal(fromCalls.checks ?? 0, 1, "3 tin phải dùng 1 query checks duy nhất");
}

// ---------------------------------------------------------------- failure paths
// Lookup signal lỗi -> scanRadar ném lỗi, KHÔNG ghi radar_matches/radars.
{
  const f = fakeDb(
    {
      market_listings: [listing("111", "2026-10-02T09:00:00Z")],
      checks: [check_("111", { score: 82 })],
      radar_matches: [],
      radars: [{ id: "radar-1" }],
    },
    [{ table: "checks", op: "select" }],
  );
  await assert.rejects(
    scanRadar(f.db, RADAR),
    (e: unknown) => (e as { code?: string }).code === "XX000",
  );
  assert.equal(f.tables.radar_matches.length, 0, "lookup lỗi -> không ghi dòng nào");
  assert.equal(f.updates.length, 0, "lookup lỗi -> radars không bị đụng");
}

// Ghi radar_matches lỗi -> dừng TRƯỚC khi update radars, không để half-state.
// Route gọi scanRadar sẽ catch và tự ghi `last_scan_error` (không bump updated_at).
{
  const f = fakeDb(
    {
      market_listings: [listing("111", "2026-10-02T09:00:00Z")],
      checks: [check_("111", { score: 82 })],
      radar_matches: [],
      radars: [{ id: "radar-1" }],
    },
    [{ table: "radar_matches", op: "upsert" }],
  );
  await assert.rejects(
    scanRadar(f.db, RADAR),
    (e: unknown) => (e as { code?: string }).code === "XX000",
  );
  assert.equal(f.tables.radar_matches.length, 0, "upsert lỗi -> radar_matches không đổi");
  assert.equal(f.updates.length, 0, "upsert lỗi -> radars không bị cập nhật nửa vời");
}

// AI chấm lỗi: Check tồn tại nhưng CHƯA có score -> coi như chưa chấm,
// tin vẫn persist unscored thay vì biến mất.
{
  const f = fakeDb({
    market_listings: [listing("111", "2026-10-02T09:00:00Z")],
    checks: [check_("111", { score: null, deal_type: null, is_ngop: null })],
    radar_matches: [],
    radars: [{ id: "radar-1" }],
  });
  const res = await scanRadar(f.db, RADAR);
  assert.equal(res.matches.length, 1, "chấm lỗi không được làm mất tin");
  assert.equal(res.matches[0]!.score, null);
  assert.equal(res.matches[0]!.scoringAvailable, false);
  assert.equal(f.tables.radar_matches.length, 1, "tin vẫn được persist");
}

// ---------------------------------------------------------------- input mutation
// scanRadar không được sửa input: rows đọc từ DB, checks, và config Radar.
{
  const f = seed();
  const listingsBefore = JSON.parse(JSON.stringify(f.tables.market_listings));
  const checksBefore = JSON.parse(JSON.stringify(f.tables.checks));
  const radarBefore = JSON.parse(JSON.stringify(RADAR));
  await scanRadar(f.db, RADAR);
  assert.deepEqual(JSON.parse(JSON.stringify(f.tables.market_listings)), listingsBefore, "input market_listings bị mutate");
  assert.deepEqual(JSON.parse(JSON.stringify(f.tables.checks)), checksBefore, "input checks bị mutate");
  assert.deepEqual(JSON.parse(JSON.stringify(RADAR)), radarBefore, "Radar config bị mutate");
}