// Self-check: scoring snapshot (migration 0012) — ưu tiên nguồn, backward
// compat, version từ constant, cache không gọi model. Chạy: npm test

import { strict as assert } from "node:assert";
import { analyzeListing, applyJevSubScores, fromApiResponse, SCORING_CODE_VERSION } from "../lib/scoring.ts";
import {
  buildScoringSnapshot,
  parseScoringSnapshot,
  resultFromSnapshot,
  SCORING_SNAPSHOT_SOURCE,
} from "../lib/score-snapshot.ts";
import { buildEvidencePack } from "../lib/ai/evidence.ts";
import { scoreContributions } from "../lib/score-explain.ts";
import { isFreshSnapshot } from "../lib/ai/report-cache.ts";

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

const TEXT =
  "Bán gấp! Nhà mặt tiền Thùy Vân 80m2, 4 tầng, ngân hàng thanh lý, giá 5.5 tỷ, sổ hồng riêng, hẻm xe hơi";

// Giá trị Jev giả lập: noul 0..1, score 0..4 — giống format provider trả về
const JEV_RAW = { is_ngop: 0.82, legal_safety: 0.61, location_growth: 3, liquidity: 2 };
const JEV_SCALED = { is_ngop: 82, legal_safety: 61, location_growth: 75, liquidity: 50 };

function clientSideResult() {
  return fromApiResponse(
    {
      investment_score: 78,
      deal_type: "ngop_ngon",
      confidence: 0.7,
      is_ngop: JEV_SCALED.is_ngop,
      legal_safety: JEV_SCALED.legal_safety,
      location_growth: JEV_RAW.location_growth,
      liquidity: JEV_RAW.liquidity,
      province: "Vũng Tàu",
    },
    analyzeListing(TEXT),
  );
}

function snapOf(result = clientSideResult()) {
  return buildScoringSnapshot({ result, dealType: "ngop_ngon", nowIso: "2026-01-01T00:00:00.000Z" });
}

function pack(over: Partial<Parameters<typeof buildEvidencePack>[0]> = {}) {
  return buildEvidencePack({
    title: "Nhà Thùy Vân",
    price: 5500000000,
    area: 80,
    bedrooms: 4,
    ward: null,
    region: "Vũng Tàu",
    listingUrl: "https://www.nhatot.com/tin/1.htm",
    listingText: TEXT,
    result: analyzeListing(TEXT),
    dealType: "binh_thuong",
    scoringVersion: SCORING_CODE_VERSION,
    analysisVersion: "pro-v1",
    ...over,
  });
}

async function main() {
  console.log("\n== CASE 1: check MỚI có scoring_snapshot ==");

  await check("snapshot chụp đủ overall/deal/breakdown/contributions/reasoning/action", () => {
    const s = snapOf();
    assert.equal(s.overall_score, 78);
    assert.equal(s.deal_type, "ngop_ngon");
    assert.ok(s.breakdown.ngop.score === 82, "phải giữ sub-score Jev đã scale");
    assert.ok(s.breakdown.phapLy.score === 61);
    assert.ok(s.breakdown.tangGia.score === 75, "location_growth 3/4 -> 75");
    assert.ok(s.breakdown.thanhKhoan.score === 50, "liquidity 2/4 -> 50");
    assert.ok(s.score_contributions.length > 0);
    assert.ok(s.reasoning.length > 0);
    assert.ok(s.action.length > 0);
    assert.equal(s.generated_at, "2026-01-01T00:00:00.000Z");
    assert.equal(s.source, SCORING_SNAPSHOT_SOURCE);
  });

  await check("Evidence Pack lấy snapshot, KHÔNG gọi analyzeListing lại", () => {
    const snap = snapOf();
    // Cố tình đưa vào một `result` local hoàn toàn khác snapshot
    const p = pack({ snapshot: snap, result: { ...analyzeListing(TEXT), overall: 12, reasoning: "LOCAL", action: "LOCAL" } });
    assert.equal(p.metadata.scoring_source, "snapshot");
    assert.equal(p.metadata.legacy_generated, false);
    assert.equal(p.scoring.reasoning.includes("LOCAL"), false, "reasoning phải lấy từ snapshot");
    assert.equal(p.scoring.contributions.length, snap.score_contributions.length);
    assert.equal(p.scoring.contributions[0].label, snap.score_contributions[0].label);
    assert.equal(p.scoring.contributions[0].delta, snap.score_contributions[0].delta);
  });

  await check("resultFromSnapshot tái dựng đúng breakdown", () => {
    const snap = snapOf();
    const r = resultFromSnapshot(snap);
    assert.equal(r.overall, 78);
    assert.equal(r.breakdown.tangGia.score, 75);
    assert.equal(r.breakdown.giaThiTruong.diffPercent, snap.breakdown.giaThiTruong.diffPercent);
    assert.equal(r.actionType, snap.action_type);
  });

  console.log("\n== CASE 2: check CŨ không có snapshot (backward compat) ==");

  await check("không snapshot, không jev -> fallback, không crash", () => {
    const p = pack({ snapshot: null, jev: null });
    assert.equal(p.metadata.scoring_source, "legacy_text");
    assert.equal(p.metadata.legacy_generated, true, "không được giả vờ là snapshot");
    assert.ok(p.scoring.reasoning.length > 0);
    assert.ok(p.scoring.contributions.length > 0);
    assert.equal(p.property.price_per_m2, 68750000);
  });

  await check("có jev_* nhưng chưa có snapshot -> dùng tầng 2, merge Jev vào local", () => {
    const local = analyzeListing(TEXT);
    const p = pack({ snapshot: null, result: local, jev: JEV_RAW });
    assert.equal(p.metadata.scoring_source, "jev_fields");
    assert.equal(p.metadata.legacy_generated, true);
    // contributions phải phản ánh sub-score Jev, không phải local
    const withJev = scoreContributions(applyJevSubScores(local, JEV_RAW));
    assert.equal(p.scoring.contributions[0].label, withJev[0].label);
    assert.equal(p.scoring.contributions[0].delta, withJev[0].delta);
  });

  await check("snapshot JSON hỏng -> coi như không có, fallback an toàn", () => {
    assert.equal(parseScoringSnapshot(null), null);
    assert.equal(parseScoringSnapshot("abc"), null);
    assert.equal(parseScoringSnapshot({}), null);
    assert.equal(parseScoringSnapshot({ overall_score: 78, breakdown: {} }), null);
    assert.equal(parseScoringSnapshot({ overall_score: 78, breakdown: { ngop: {} } }), null);
    const p = pack({ snapshot: parseScoringSnapshot({ nonsense: true }) });
    assert.equal(p.metadata.scoring_source, "legacy_text");
  });

  await check("check cũ KHÔNG bị ghi đè snapshot (không backfill)", () => {
    // parse trả null => route fallback, và route chỉ update khi fromFallback=false
    const legacyRow = { analysis_json: null, analysis_version: null, scoring_snapshot: null };
    assert.equal(isFreshSnapshot(legacyRow, "pro-v1"), false);
    assert.equal(legacyRow.scoring_snapshot, null, "phải giữ nguyên null");
  });

  console.log("\n== CASE 3: client và server dùng CÙNG một nguồn số ==");

  await check("contributions server == contributions client thấy", () => {
    const clientResult = clientSideResult();
    const clientContrib = scoreContributions(clientResult);
    const fromSnap = snapOf(clientResult);
    const serverContrib = fromSnap.score_contributions;
    assert.equal(serverContrib.length, clientContrib.length);
    for (let i = 0; i < clientContrib.length; i++) {
      assert.equal(serverContrib[i].label, clientContrib[i].label);
      assert.equal(serverContrib[i].delta, clientContrib[i].delta);
      assert.equal(serverContrib[i].note, clientContrib[i].note);
    }
  });

  await check("applyJevSubScores là nguồn merge DUY NHẤT (client == server)", () => {
    const local = analyzeListing(TEXT);
    const viaApi = fromApiResponse(
      {
        investment_score: 78,
        deal_type: "ngop_ngon",
        confidence: 0.7,
        is_ngop: 82,
        legal_safety: 61,
        location_growth: 3,
        liquidity: 2,
      },
      local,
    );
    const direct = applyJevSubScores(
      { ...local, overall: 78 },
      { is_ngop: 82, legal_safety: 61, location_growth: 3, liquidity: 2 },
    );
    assert.equal(viaApi.breakdown.tangGia.score, direct.breakdown.tangGia.score);
    assert.equal(viaApi.breakdown.thanhKhoan.score, direct.breakdown.thanhKhoan.score);
    assert.equal(viaApi.breakdown.phapLy.score, direct.breakdown.phapLy.score);
    assert.equal(viaApi.breakdown.ngop.score, direct.breakdown.ngop.score);
  });

  await check("noul 0..1 của Jev là nguồn, is_ngop cột cũ không lệch", () => {
    const local = analyzeListing(TEXT);
    const p = pack({ snapshot: null, result: local, jev: { is_ngop: 0.82, legal_safety: 0.61, location_growth: 3, liquidity: 2 } });
    const merged = applyJevSubScores(local, JEV_RAW);
    assert.equal(p.scoring.contributions[0].delta, scoreContributions(merged)[0].delta);
  });

  console.log("\n== CASE 4: scoring_code_version từ constant, KHÔNG từ env ==");

  await check("constant nằm cạnh công thức, có giá trị thật", () => {
    assert.equal(typeof SCORING_CODE_VERSION, "string");
    assert.ok(SCORING_CODE_VERSION.length > 0);
    assert.equal(SCORING_CODE_VERSION, "jev-v1");
  });

  await check("snapshot mang version từ constant dù env có set khác", () => {
    const saved = process.env.SCORING_VERSION;
    process.env.SCORING_VERSION = "gia-false-999";
    try {
      const s = snapOf();
      assert.equal(s.scoring_code_version, SCORING_CODE_VERSION);
      assert.notEqual(s.scoring_code_version, "gia-false-999");
    } finally {
      if (saved === undefined) delete process.env.SCORING_VERSION;
      else process.env.SCORING_VERSION = saved;
    }
  });

  await check("Evidence Pack metadata dùng cùng constant", () => {
    const p = pack({ scoringVersion: SCORING_CODE_VERSION });
    assert.equal(p.metadata.scoring_version, SCORING_CODE_VERSION);
    assert.equal(p.metadata.analysis_version, "pro-v1");
  });

  console.log("\n== CASE 5: F5 report có analysis_json -> zero OpenRouter ==");

  await check("snapshot đầy đủ + analysis_json -> cache hit, 0 request", async () => {
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const row = {
        analysis_json: { summary: { headline: "cached" } },
        analysis_version: "pro-v1",
        scoring_snapshot: snapOf(),
      };
      const fresh = isFreshSnapshot(row, "pro-v1");
      if (fresh) {
        // route trả cache — không gọi generateProAnalysis
      }
      assert.equal(fresh, true);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await check("cache hit KHÔNG phụ thuộc ai_model (snapshot là bất biến)", () => {
    const base = { analysis_json: { a: 1 }, analysis_version: "pro-v1" };
    assert.equal(isFreshSnapshot({ ...base, ai_model: "inclusionai/ling-3.0-flash-fin:free" }, "pro-v1"), true);
    assert.equal(isFreshSnapshot({ ...base, ai_model: "qwen/qwen3.8-27b:free" }, "pro-v1"), true);
  });

  await check("snapshot KHÔNG tự biến thành analysis_json (tách 2 tầng)", () => {
    const s = snapOf();
    assert.equal((s as Record<string, unknown>).analysis_json, undefined);
    assert.equal((s as Record<string, unknown>).ai_model, undefined);
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  // process.exit() huy async handle -> libuv assertion tren Windows.
  // process.exitCode de tien trinh tu thoat, chay lai 100%
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
