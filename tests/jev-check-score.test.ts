// Self-check: investmentScore100 + mapEnrichmentAnswers.
// Khoá behavior CŨ của /api/check (JS coerce chuỗi số) — việc tách hàm lúc refactor
// đã từng biến "3" thành 0, và 0 đó được persist thành Radar signal.
import assert from "node:assert/strict";
import { investmentScore100, CHECK_QUESTIONS } from "@/lib/ai/jev-check";
import { mapEnrichmentAnswers } from "@/lib/radar/enrichment-provider";

let failures = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ok  ${name}`); } catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
}

test('P2-1 REGRESSION: chuỗi số "3" -> 75 (KHÔNG phải 0)', () => {
  assert.equal(investmentScore100("3"), 75);
  assert.equal(investmentScore100("0"), 0);
  assert.equal(investmentScore100("4"), 100);
  assert.equal(investmentScore100(" 2 "), 50);
});

test("P2-1 ma trận input đầy đủ", () => {
  const cases: [unknown, number | null][] = [
    [undefined, null],
    [null, null],
    [0, 0],
    [0.4, 10],
    [4, 100],
    [5, 5],
    [100, 100],
    [-1, -25],
    [NaN, null],
    [Infinity, null],
    ["abc", null],
    ["", null],
    ["   ", null],
    [true, null],
    [{}, null],
    [[], null],
    [null as unknown, null],
  ];
  for (const [input, expected] of cases) {
    assert.equal(investmentScore100(input), expected, `input ${JSON.stringify(input) ?? "undefined"} phải ra ${String(expected)}`);
  }
  // -1 là score âm: giữ đúng behavior cũ (-1 <= 4 -> quy về thang 100 = -25),
  // và KHÔNG bao giờ đổi thành 0 trong DB.
  assert.equal(investmentScore100(-1), -25);
  assert.notEqual(investmentScore100(-1), 0, "score âm phải khác 0");
  assert.equal(investmentScore100("-1"), -25, "chuỗi số âm cũng coerce như cũ");
});

test("P2-1 giá trị trong DB không bao giờ là 0 do input hỏng", () => {
  for (const bad of [undefined, null, NaN, "abc", "", {}, [], true]) {
    assert.equal(investmentScore100(bad) === 0 ? "zero" : "null", "null", `input ${JSON.stringify(bad)} không được ra 0`);
  }
});

test("mapEnrichmentAnswers: chuỗi số vẫn publish được (không rơi về insufficient_data)", () => {
  const out = mapEnrichmentAnswers({ answers: { investment_potential: { score: "3" }, deal_type: { choice: "ngop_ngon", confidence: 0.9 }, is_ngop: { noul: 0.5 } } });
  assert.equal(out.kind, "published");
  if (out.kind !== "published") return;
  assert.equal(out.score, 75);
  assert.equal(out.dealType, "ngop_ngon");
  assert.equal(out.isNgoP, 50);
});

test("không đổi deal_type fallback và is_ngop rounding", () => {
  // is_ngop: noul 0..1 -> thang 100, làm tròn.
  const half = mapEnrichmentAnswers({ answers: { investment_potential: { score: 4 }, deal_type: { choice: "binh_thuong", confidence: 0.6 }, is_ngop: { noul: 0.005 } } });
  assert.equal(half.kind, "published");
  if (half.kind === "published") assert.equal(half.isNgoP, 1, "0.005 -> 1 (làm tròn)");

  const zero = mapEnrichmentAnswers({ answers: { investment_potential: { score: 4 }, deal_type: { choice: "binh_thuong", confidence: 0.6 }, is_ngop: { noul: 0 } } });
  assert.equal(zero.kind, "published");
  if (zero.kind === "published") assert.equal(zero.isNgoP, 0, "noul 0 là giá trị THẬT (0), không phải unknown");

  const unknownDeal = mapEnrichmentAnswers({ answers: { investment_potential: { score: 4 }, deal_type: { choice: "loai_la", confidence: 0.9 }, is_ngop: { noul: 0.5 } } });
  assert.equal(unknownDeal.kind, "published");
  if (unknownDeal.kind === "published") assert.equal(unknownDeal.dealType, null, "deal_type lạ -> null, KHÔNG default binh_thuong");

  const noChoice = mapEnrichmentAnswers({ answers: { investment_potential: { score: 4 }, deal_type: { confidence: 0.9 }, is_ngop: { noul: 0.5 } } });
  assert.equal(noChoice.kind, "published");
  if (noChoice.kind === "published") assert.equal(noChoice.dealType, null);
});

test("bộ câu hỏi dùng chung không bị lệch", () => {
  assert.equal(CHECK_QUESTIONS.deal_type.type, "choice");
  assert.equal(CHECK_QUESTIONS.investment_potential.type, "score");
  assert.equal(CHECK_QUESTIONS.is_ngop.type, "noul");
  assert.ok("binh_thuong" in CHECK_QUESTIONS.deal_type.criteria, "criteria deal_type phải có binh_thuong");
});

console.log(`\njev-check-score: ${failures} fail`);
process.exitCode = failures ? 1 : 0;