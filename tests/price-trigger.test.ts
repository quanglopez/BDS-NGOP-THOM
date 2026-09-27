// Self-check: trigger + view-model của Price Intelligence trên report page.
// Chạy: npm test — fetch được stub, không mạng, không React.
import { strict as assert } from "node:assert";
import {
  buildPriceViewModel,
  loadPriceIntelligence,
  type PriceFetchLike,
  type PriceLoadResult,
} from "../lib/price/trigger.ts";
import type { PriceIntelligence } from "../lib/price/types.ts";

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

const CHECK_ID = "92f3fa9b-2ec1-445b-a743-90fa96956c67";

function snapshot(over: Partial<PriceIntelligence> = {}): PriceIntelligence {
  return {
    version: "price-v1",
    generated_at: "2026-09-27T09:20:00.000Z",
    source: "chotot_gateway",
    scope_level: "ward",
    scope: {
      scope_level: "ward",
      scope_key: "ward:13101|cat:1020|size:27-72|rooms:1-3",
      scope_description: "Quận 6 · Nhà ở",
      region_name: "Tp Hồ Chí Minh",
      area_name: "Quận 6",
      category_code: 1020,
      category_name: "Nhà ở",
      size_min_m2: 27,
      size_max_m2: 72,
      rooms_min: 1,
      rooms_max: 3,
    },
    sample_size: 75,
    trimmed_size: 70,
    confidence: "high",
    quality_score: 0.88,
    excluded_promoted: 4,
    excluded_invalid: 12,
    statistics: {
      p25_ppm2: 130_000_000,
      median_ppm2: 152_000_000,
      p75_ppm2: 175_000_000,
      min_ppm2: 102_000_000,
      max_ppm2: 205_000_000,
    },
    comparables: [
      {
        external_id: "c1",
        title: "Tin A",
        size_m2: 46,
        price_vnd: 4_692_000_000,
        price_per_m2: 102_000_000,
        rooms: 3,
        distance_km: 0.8,
        listed_at: null,
        url: "https://www.nhatot.com/tin/c1.htm",
      },
    ],
    target: { price_per_m2: 73_333_333, difference_percent: -51.8 },
    limitations: ["Giá chào bán lấy từ tin đăng, không phải giá giao dịch thực tế."],
    ...over,
  };
}

interface Call {
  method: string;
  url: string;
}

function stubFetch(
  responses: Record<string, { status: number; body: unknown }>,
): { impl: PriceFetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const impl: PriceFetchLike = async (url, init) => {
    calls.push({ method: init.method, url });
    const key = init.method === "GET" ? "GET" : "POST";
    const r = responses[key] ?? { status: 500, body: { error: "unexpected" } };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    };
  };
  return { impl, calls };
}

const OK_NOT_GENERATED = { status: 200, body: { ok: false, reason: "not_generated", message: "Chưa có dữ liệu tham chiếu cho báo cáo này." } };
const OK_READY = { status: 200, body: { ok: true, cached: true, data: snapshot() } };
const OK_READY_FRESH = { status: 200, body: { ok: true, cached: false, data: snapshot() } };
const OK_NOT_ENOUGH = { status: 200, body: { ok: false, reason: "not_enough_data", message: "Chưa xác định được loại bất động sản để tạo nhóm tham chiếu phù hợp." } };
const OK_UNAVAILABLE = { status: 200, body: { ok: false, reason: "temporary_unavailable", message: "Phân tích giá tham chiếu tạm thời chưa khả dụng." } };

async function main() {
  console.log("\n== TEST 1: Report Pro + chưa có snapshot -> POST được gọi ==");

  await check("GET not_generated -> POST 1 lần, ra data", async () => {
    const { impl, calls } = stubFetch({ GET: OK_NOT_GENERATED, POST: OK_READY_FRESH });
    const r = await loadPriceIntelligence({ checkId: CHECK_ID, isPro: true, fetchImpl: impl });
    assert.equal(r.state, "ready");
    assert.equal(r.getCalls, 1);
    assert.equal(r.postCalls, 1);
    assert.deepEqual(calls.map((c) => c.method), ["GET", "POST"]);
    assert.ok(calls[1].url.includes("/api/price-intelligence"));
    assert.ok((calls[1].url === "/api/price-intelligence"), "POST vào endpoint gốc, không có query");
  });

  await check("POST gửi đúng checkId trong body", async () => {
    let body: unknown = null;
    const impl: PriceFetchLike = async (_url, init) => {
      if (init.method === "POST") body = JSON.parse(init.body ?? "{}");
      const r = init.method === "GET" ? OK_NOT_GENERATED : OK_READY_FRESH;
      return { ok: true, status: 200, json: async () => r.body };
    };
    await loadPriceIntelligence({ checkId: CHECK_ID, isPro: true, fetchImpl: impl });
    assert.deepEqual(body, { checkId: CHECK_ID });
  });

  await check("GET dùng checkId trong query string", async () => {
    const { impl, calls } = stubFetch({ GET: OK_READY, POST: OK_READY });
    await loadPriceIntelligence({ checkId: CHECK_ID, isPro: true, fetchImpl: impl });
    assert.ok(calls[0].url.includes(`checkId=${CHECK_ID}`));
  });

  console.log("\n== TEST 2: Report Pro + đã có snapshot -> 0 POST ==");

  await check("GET cached -> ready, KHÔNG gọi POST", async () => {
    const { impl, calls } = stubFetch({ GET: OK_READY, POST: OK_READY });
    const r = await loadPriceIntelligence({ checkId: CHECK_ID, isPro: true, fetchImpl: impl });
    assert.equal(r.state, "ready");
    assert.equal(r.cached, true);
    assert.equal(r.postCalls, 0, "không được POST khi đã có snapshot");
    assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  });

  await check("GET 200 ok:false lạ -> không POST (tránh dội request)", async () => {
    const { impl, calls } = stubFetch({
      GET: { status: 200, body: { ok: false, reason: "temporary_unavailable", message: "tạm lỗi" } },
      POST: OK_READY,
    });
    const r = await loadPriceIntelligence({ checkId: CHECK_ID, isPro: true, fetchImpl: impl });
    assert.equal(r.state, "unavailable");
    assert.equal(r.postCalls, 0);
    assert.equal(calls.length, 1);
  });

  await check("GET 429 / 5xx -> không POST, state unavailable", async () => {
    for (const status of [429, 500, 503]) {
      const { impl, calls } = stubFetch({ GET: { status, body: {} }, POST: OK_READY });
      const r = await loadPriceIntelligence({ checkId: CHECK_ID, isPro: true, fetchImpl: impl });
      assert.equal(r.state, "unavailable");
      assert.equal(r.postCalls, 0, `status ${status} không được POST`);
      assert.equal(calls.length, 1);
    }
  });

  console.log("\n== TEST 3: Free user -> 0 mạng ==");

  await check("isPro=false -> 0 GET, 0 POST, state locked", async () => {
    const { impl, calls } = stubFetch({ GET: OK_READY, POST: OK_READY });
    const r = await loadPriceIntelligence({ checkId: CHECK_ID, isPro: false, fetchImpl: impl });
    assert.equal(r.state, "locked");
    assert.equal(r.getCalls, 0);
    assert.equal(r.postCalls, 0);
    assert.equal(calls.length, 0, "Free không được chạm mạng");
  });

  await check("view-model của Free -> locked, không skeleton, không số", () => {
    const r: PriceLoadResult = {
      state: "locked",
      data: null,
      cached: false,
      getCalls: 0,
      postCalls: 0,
      message: null,
    };
    const vm = buildPriceViewModel(r);
    assert.equal(vm.locked, true);
    assert.equal(vm.showSkeleton, false);
    assert.equal(vm.canShowStats, false);
    assert.equal(vm.medianPpm2, null);
    assert.ok(vm.heading.includes("Mở khóa"));
  });

  console.log("\n== TEST 4: POST thành công -> UI đủ dữ liệu ==");

  await check("view-model có sample_size, confidence, median, comparables", async () => {
    const { impl } = stubFetch({ GET: OK_NOT_GENERATED, POST: OK_READY_FRESH });
    const r = await loadPriceIntelligence({ checkId: CHECK_ID, isPro: true, fetchImpl: impl });
    const vm = buildPriceViewModel(r);
    assert.equal(vm.showSkeleton, false);
    assert.equal(vm.locked, false);
    assert.equal(vm.sampleSize, 75);
    assert.equal(vm.trimmedSize, 70);
    assert.ok(vm.confidence);
    assert.equal(vm.confidence!.label, "Cao");
    assert.equal(vm.medianPpm2, 152_000_000);
    assert.equal(vm.p25Ppm2, 130_000_000);
    assert.equal(vm.p75Ppm2, 175_000_000);
    assert.equal(vm.differencePercent, -51.8);
    assert.equal(vm.comparables.length, 1);
    assert.equal(vm.comparables[0].distance_km, 0.8);
    assert.equal(vm.canShowStats, true);
    assert.equal(vm.scopeLevel, "ward");
    assert.ok(vm.scopeDescription!.includes("Quận 6"));
  });

  await check("câu nguồn mẫu nói rõ đã loại bao nhiêu tin", () => {
    const vm = buildPriceViewModel({
      state: "ready",
      data: snapshot(),
      cached: false,
      getCalls: 1,
      postCalls: 1,
      message: null,
    });
    assert.ok(vm.sampleLine.includes("75 tin đăng hợp lệ"), vm.sampleLine);
    assert.ok(vm.sampleLine.includes("12 tin không phù hợp"), vm.sampleLine);
    assert.ok(vm.sampleLine.includes("4 tin quảng cáo"), vm.sampleLine);
  });

  await check("không có tin quảng cáo thì không nhắc", () => {
    const s = snapshot({ excluded_promoted: 0, excluded_invalid: 0 });
    const vm = buildPriceViewModel({ state: "ready", data: s, cached: true, getCalls: 1, postCalls: 0, message: null });
    assert.equal(vm.sampleLine, "Dựa trên 75 tin đăng hợp lệ.");
  });

  await check("sample < 15 -> canShowStats false, KHÔNG hiện median", () => {
    const s = snapshot({ sample_size: 8, statistics: null });
    const vm = buildPriceViewModel({ state: "ready", data: s, cached: true, getCalls: 1, postCalls: 0, message: null });
    assert.equal(vm.canShowStats, false);
    assert.equal(vm.medianPpm2, null, "không được hiện median khi thiếu mẫu");
    assert.equal(vm.sampleSize, 8);
  });

  await check("comparables tối đa 6", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      external_id: `c${i}`, title: null, size_m2: 45, price_vnd: 1e9,
      price_per_m2: 1e7, rooms: 2, distance_km: null, listed_at: null, url: null,
    }));
    const vm = buildPriceViewModel({
      state: "ready", data: snapshot({ comparables: many }), cached: true,
      getCalls: 1, postCalls: 0, message: null,
    });
    assert.equal(vm.comparables.length, 6);
  });

  console.log("\n== TEST 5: POST fail -> report vẫn xem bình thường ==");

  await check("not_enough_data -> có lời giải thích, KHÔNG số", async () => {
    const { impl } = stubFetch({ GET: OK_NOT_GENERATED, POST: OK_NOT_ENOUGH });
    const r = await loadPriceIntelligence({ checkId: CHECK_ID, isPro: true, fetchImpl: impl });
    assert.equal(r.state, "not_enough");
    const vm = buildPriceViewModel(r);
    assert.equal(vm.showSkeleton, false);
    assert.ok(vm.message && vm.message.includes("loại bất động sản"), vm.message ?? "");
    assert.equal(vm.medianPpm2, null);
    assert.equal(vm.comparables.length, 0);
    assert.equal(vm.canShowStats, false);
  });

  await check("temporary_unavailable -> lời giải thích, không crash", async () => {
    const { impl } = stubFetch({ GET: OK_NOT_GENERATED, POST: OK_UNAVAILABLE });
    const r = await loadPriceIntelligence({ checkId: CHECK_ID, isPro: true, fetchImpl: impl });
    assert.equal(r.state, "unavailable");
    const vm = buildPriceViewModel(r);
    assert.ok(vm.message!.includes("tạm thời chưa khả dụng"));
    assert.equal(vm.locked, false);
  });

  await check("POST 500 / lỗi mạng -> unavailable, không throw ra ngoài", async () => {
    const { impl } = stubFetch({ GET: OK_NOT_GENERATED, POST: { status: 500, body: {} } });
    const r = await loadPriceIntelligence({ checkId: CHECK_ID, isPro: true, fetchImpl: impl });
    assert.equal(r.state, "unavailable");

    const throwing: PriceFetchLike = async () => {
      throw new Error("network down");
    };
    const r2 = await loadPriceIntelligence({ checkId: CHECK_ID, isPro: true, fetchImpl: throwing });
    assert.equal(r2.state, "unavailable", "lỗi mạng không được ném ra ngoài");
  });

  await check("GET 401/403 -> không POST; 403 = locked", async () => {
    const { impl, calls } = stubFetch({ GET: { status: 403, body: { error: "locked" } }, POST: OK_READY });
    const r = await loadPriceIntelligence({ checkId: CHECK_ID, isPro: true, fetchImpl: impl });
    assert.equal(r.state, "locked");
    assert.equal(r.postCalls, 0);
    assert.equal(calls.length, 1);

    const { impl: impl2, calls: c2 } = stubFetch({ GET: { status: 401, body: { error: "Cần đăng nhập" } }, POST: OK_READY });
    const r2 = await loadPriceIntelligence({ checkId: CHECK_ID, isPro: true, fetchImpl: impl2 });
    assert.equal(r2.state, "unavailable");
    assert.equal(r2.postCalls, 0);
    assert.equal(c2.length, 1);
  });

  await check("chưa load xong -> skeleton riêng, KHÔNG phải skeleton AI", () => {
    const vm = buildPriceViewModel(null);
    assert.equal(vm.showSkeleton, true, "phải có skeleton riêng lúc đang tải");
    assert.equal(vm.locked, false);
    assert.equal(vm.heading, "Phân tích giá tham chiếu");
  });

  // Component dùng toLocaleString("vi-VN"). Nếu render lúc chưa có data thì
  // server (Node ICU) và client (browser ICU) có thể format khác nhau -> lỗi
  // hydration. Hai trạng thái render đầu tiên (skeleton + locked) phải KHÔNG
  // chứa số nào, để prove số chỉ được format sau khi hydrate.
  await check("an toan hydration: skeleton/locked khong chua so nao de format", () => {
    const skeleton = buildPriceViewModel(null);
    const locked = buildPriceViewModel({
      state: "locked", data: null, cached: false, getCalls: 0, postCalls: 0, message: null,
    });
    for (const vm of [skeleton, locked]) {
      for (const k of [
        "targetPpm2", "medianPpm2", "p25Ppm2", "p75Ppm2",
        "minPpm2", "maxPpm2", "differencePercent",
      ] as const) {
        assert.equal(vm[k], null, `${k} phải null trước khi có data (tránh lệch ICU)`);
      }
      assert.equal(vm.comparables.length, 0, "không có comparable trước khi có data");
      assert.equal(vm.canShowStats, false);
    }
  });

  await check("du lieu den sau -> moi format, mot lan duy nhat", () => {
    // Snapshot chỉ được set 1 lần trong state -> không re-render lặp lại số khác nhau.
    const vm = buildPriceViewModel({
      state: "ready", data: snapshot(), cached: true, getCalls: 1, postCalls: 0, message: null,
    });
    assert.equal(vm.medianPpm2, 152_000_000);
    assert.notEqual(vm.medianPpm2, null);
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
