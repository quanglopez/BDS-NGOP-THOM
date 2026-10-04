// Hồi quy ổn định cho /api/pro-analysis — 3 failure mode production đã ghi nhận:
//   A. provider_truncated  finish_reason=length, output_truncated=true
//   B. Vercel Runtime Timeout sau 60s
//   C. guard_rejected       "pháp lý đã được xác minh"
// Chạy: npm test — không gọi mạng thật, fetch được stub, không phụ thuộc AI provider.

import { strict as assert } from "node:assert";
import { jsonResponse, sseResponse } from "./openrouter-sse.ts";
import {
  generateProAnalysis,
  chainBudgetMs,
  MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS_RETRY,
  maxOutputTokens,
  maxOutputTokensRetry,
  MIN_CALL_BUDGET_MS,
} from "../lib/ai/pro-analysis.ts";
import { PRO_ANALYSIS_SYSTEM_PROMPT } from "../lib/ai/prompts.ts";
import { BANNED_VERIFIED_CLAIMS, BANNED_ADVICE } from "../lib/ai/guard.ts";
import { buildEvidencePack } from "../lib/ai/evidence.ts";
import { analyzeListing } from "../lib/scoring.ts";
import type { ProAnalysis } from "../lib/ai/schema.ts";

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

const DEEPSEEK = "deepseek/deepseek-v4.1-flash";
const QWEN_PAID = "qwen/qwen3.8-27b";
const GEMMA = "google/gemma-4-31b-it:free";

const SAMPLE_TEXT = "Bán căn hộ 2 phòng ngủ 72m2 tại Cầu Giấy, Hà Nội. Giá 7,3 tỷ. Đã thanh toán 50%.";

function sampleEvidence() {
  return buildEvidencePack({
    title: "Bán căn hộ Cầu Giấy",
    price: 7.3e9,
    area: 72,
    bedrooms: 2,
    ward: null,
    region: "Hà Nội",
    listingUrl: "https://example.com/listing",
    listingText: SAMPLE_TEXT,
    result: analyzeListing(SAMPLE_TEXT),
    dealType: "binh_thuong",
    scoringVersion: "scoring-test",
    analysisVersion: "pro-v1",
    snapshot: null,
    jev: null,
  });
}

function cleanAnalysis(): ProAnalysis {
  return {
    summary: { headline: "Căn hộ 72m2 tại Cầu Giấy, giá 7,3 tỷ.", text: "Điểm 78/100 dựa trên nội dung tin.", confidence: "medium" },
    highlights: [{ type: "positive", title: "Vị trí", explanation: "Nằm tại khu vực có nhu cầu.", evidence_source: "listing" }],
    score_explanation: { summary: "Điểm do hệ thống chấm.", strengths: [], weaknesses: [] },
    factor_analysis: [],
    price_analysis: { available: true, asking_price: 7.3e9, price_per_m2: Math.round(7.3e9 / 72), reference_available: false, reference_median: null, difference_percent: null, explanation: "Chưa đủ dữ liệu tham chiếu." },
    warnings: [],
    next_steps: [{ priority: "medium", title: "Kiểm tra sổ", reason: "Cần xác minh trực tiếp." }],
    limitations: ["Mọi nhận định dựa trên nội dung tin đăng."],
  };
}

// Guard chặn khi output chứa đúng cụm cấm. Dùng cụm xuất hiện trong log production.
function analysisWithBannedClaim(): ProAnalysis {
  const a = cleanAnalysis();
  return { ...a, summary: { ...a.summary, text: "Pháp lý đã được xác minh." } };
}

interface Captured { model: string; body: Record<string, unknown>; }

type Responder = (model: string, attempt: number) => { status: number; payload: unknown };

/**
 * Stub fetch. Trả về MẢNG request đã capture (push dần vào cùng một mảng),
 * để assert được ngay sau khi stub còn active.
 * `delayMs` mô phỏng provider chậm để test budget tổng.
 */
function stubFetch(responder: Responder, delayMs = 0): Captured[] {
  const captured: Captured[] = [];
  const attemptByModel = new Map<string, number>();
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const model = String(body.model);
    const n = (attemptByModel.get(model) ?? 0) + 1;
    attemptByModel.set(model, n);
    captured.push({ model, body });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const r = responder(model, n);
    return r.status === 200 ? sseResponse(r.payload, model) : jsonResponse(r.status, r.payload);
  }) as typeof fetch;
  return captured;
}

function ok(model: string, analysis: unknown = cleanAnalysis()) {
  return { status: 200, payload: { model, choices: [{ message: { content: JSON.stringify(analysis) }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 400 } } };
}

// Case A: provider cắt cụt vì chạm max_tokens (finish_reason=length).
function truncated(model: string) {
  return {
    status: 200,
    payload: {
      model,
      choices: [{ message: { content: '{"summary":{"headline":"Căn hộ 72m2' }, finish_reason: "length" }],
      usage: { prompt_tokens: 900, completion_tokens: 3000 },
    },
  };
}

function rateLimited() { return { status: 429, payload: { error: { message: "Rate limit exceeded" } } }; }
function serverError() { return { status: 500, payload: { error: { message: "upstream boom" } } }; }
function badJson() { return { status: 200, payload: { model: "", choices: [{ message: { content: "{khong phai json" }, finish_reason: "stop" }] } }; }

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return await fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const realFetch = globalThis.fetch;

// Chain 2 model: primary + 1 fallback. Không set budget -> dùng mặc định.
function env(primary: string, fallbacks: string) {
  return {
    OPENROUTER_API_KEY: "test-key",
    JEV_API_KEY: undefined,
    JEV_DECISION: "off",
    PRO_ANALYSIS_MODEL: primary,
    PRO_ANALYSIS_FALLBACK_MODELS: fallbacks,
    PRO_ANALYSIS_CHAIN_BUDGET_MS: undefined,
  };
}

const evidence = sampleEvidence();

async function main() {
  // ---------------------------------------------------------------
  // PHASE 2 — REPRODUCE: 3 failure mode production
  // ---------------------------------------------------------------

  // Case A — attempt 2 sau khi attempt 1 bị cắt phải KHÁC attempt 1.
  // Bug: trước fix, attempt 2 gửi lại đúng max_tokens của attempt 1,
  // nên một lỗi "hết token" bị lặp y hệt -> chắc chắn cắt lại.
  await check("A/repro: retry sau provider_truncated phải tăng max_tokens", async () => {
    const captured = stubFetch(() => truncated(DEEPSEEK));
    try {
      await withEnv(env(DEEPSEEK, QWEN_PAID), () => generateProAnalysis(evidence));
    } finally { globalThis.fetch = realFetch; }
    const first = captured.filter((c) => c.model === DEEPSEEK);
    assert.ok(first.length >= 2, `phai co >=2 request toi DeepSeek, thuc te co ${first.length}`);
    const t1 = Number(first[0].body.max_tokens);
    const t2 = Number(first[1].body.max_tokens);
    assert.ok(
      t2 > t1,
      `attempt 2 phai tang max_tokens de con du khong gia (attempt1=${t1}, attempt2=${t2}). ` +
      `Neu giu nguyen ${t1}, provider se cat lai y het.`,
    );
  });

  // Case B — chain phai co deadline TONG, khong phai deadline tung request.
  // Bug: truoc fix khong ton tai budget nao o pro-analysis.ts; tong timeout
  // co the = 3 model x 2 attempt x (15s|30s) > maxDuration 60s cua route.
  await check("B/repro: chain phai dung lai khi het budget (khong goi vo han)", async () => {
    const captured = stubFetch(() => serverError());
    try {
      await withEnv({ ...env(DEEPSEEK, `${QWEN_PAID},${GEMMA}`), PRO_ANALYSIS_CHAIN_BUDGET_MS: "1" }, () =>
        generateProAnalysis(evidence),
      );
    } finally { globalThis.fetch = realFetch; }
    assert.equal(
      captured.length, 0,
      `budget 1ms phai chan ngay TRUOC khi goi provider, thuc te da goi ${captured.length} request`,
    );
  });

  // Case C — prompt khong duoc chua nguyen van cụm mà guard cấm.
  // Bug: truoc fix PRO_ANALYSIS_SYSTEM_PROMPT liệt kê chính các cụm bị guard
  // chặn trong mục "Never say" -> model echo lai -> guard reject.
  await check("C/repro: system prompt khong chua nguyen van cum guard cam", async () => {
    const prompt = PRO_ANALYSIS_SYSTEM_PROMPT.toLowerCase();
    const leaked = [...BANNED_VERIFIED_CLAIMS, ...BANNED_ADVICE].filter((c) => prompt.includes(c.toLowerCase()));
    assert.deepEqual(
      leaked, [],
      `prompt dang chua nguyen van ${leaked.length} cum ma guard cam: ${leaked.map((c) => `"${c}"`).join(", ")}. ` +
      `Model se echo lai cum do va guard reject.`,
    );
  });

  // ---------------------------------------------------------------
  // PHASE 5 — 10 CASE HOI QUY
  // ---------------------------------------------------------------

  await check("1. primary success", async () => {
    stubFetch(() => ok(DEEPSEEK));
    try {
      const out = await withEnv(env(DEEPSEEK, QWEN_PAID), () => generateProAnalysis(evidence));
      assert.equal(out.fromFallback, false);
      assert.equal(out.metrics.fallback_used, false);
      assert.ok(out.model, "phai co model thuc te");
    } finally { globalThis.fetch = realFetch; }
  });

  await check("2. primary truncated -> fallback success", async () => {
    const captured = stubFetch((model) => (model === DEEPSEEK ? truncated(DEEPSEEK) : ok(QWEN_PAID)));
    try {
      const out = await withEnv(env(DEEPSEEK, QWEN_PAID), () => generateProAnalysis(evidence));
      assert.equal(out.fromFallback, false, "fallback phia sau phai ra duoc report that");
      assert.equal(out.metrics.provider_errors.includes("provider_truncated"), true);
      assert.ok(captured.some((c) => c.model === QWEN_PAID), "phai co request toi fallback");
    } finally { globalThis.fetch = realFetch; }
  });

  await check("3. primary truncated -> fallback truncated -> deterministic fallback", async () => {
    stubFetch(() => truncated(DEEPSEEK));
    try {
      const out = await withEnv(env(DEEPSEEK, QWEN_PAID), () => generateProAnalysis(evidence));
      assert.equal(out.fromFallback, true, "ca 2 model deu cat -> phai tra fallback deterministic");
      assert.equal(out.model, null);
      assert.ok(out.analysis.summary.headline, "fallback deterministic van phai co headline");
    } finally { globalThis.fetch = realFetch; }
  });

  await check("4. primary fail (429) -> fallback success", async () => {
    const captured = stubFetch((model) => (model === DEEPSEEK ? rateLimited() : ok(QWEN_PAID)));
    try {
      const out = await withEnv(env(DEEPSEEK, QWEN_PAID), () => generateProAnalysis(evidence));
      assert.equal(out.fromFallback, false);
      assert.equal(out.metrics.rate_limited, true);
      // 429 khong retry lai cung model -> chi 1 request cho primary
      assert.equal(captured.filter((c) => c.model === DEEPSEEK).length, 1, "429 khong duoc retry cung model");
    } finally { globalThis.fetch = realFetch; }
  });

  await check("5. primary + fallback deu fail -> deterministic fallback, khong 500", async () => {
    stubFetch(() => serverError());
    try {
      const out = await withEnv(env(DEEPSEEK, QWEN_PAID), () => generateProAnalysis(evidence));
      assert.equal(out.fromFallback, true);
      assert.equal(out.fallbackReason, "all_models_failed");
      assert.ok(out.analysis.summary.headline, "van phai co report deterministic de UI khong trang");
    } finally { globalThis.fetch = realFetch; }
  });

  await check("6. guard rejection -> fallback model ra report sach", async () => {
    stubFetch((model) =>
      model === DEEPSEEK
        ? ok(DEEPSEEK, analysisWithBannedClaim())
        : ok(QWEN_PAID, cleanAnalysis()),
    );
    try {
      const out = await withEnv(env(DEEPSEEK, QWEN_PAID), () => generateProAnalysis(evidence));
      assert.equal(out.fromFallback, false, "model sach phai ra duoc report that");
      assert.equal(out.metrics.guard_failed, true, "phai ghi nhan guard da chan");
      assert.equal(out.model, QWEN_PAID);
    } finally { globalThis.fetch = realFetch; }
  });

  await check("7. guard rejection o ca primary va fallback -> deterministic, khong loop", async () => {
    const captured = stubFetch(() => ok(DEEPSEEK, analysisWithBannedClaim()));
    try {
      const out = await withEnv(env(DEEPSEEK, QWEN_PAID), () => generateProAnalysis(evidence));
      assert.equal(out.fromFallback, true, "2 model deu bi guard chan -> phai tra deterministic");
      assert.equal(out.metrics.guard_failed, true);
      assert.ok(captured.length <= 4, `2 model x 2 attempt = toi da 4 request, thuc te ${captured.length}`);
    } finally { globalThis.fetch = realFetch; }
  });

  await check("8. malformed structured output -> fallback success", async () => {
    stubFetch((model) => (model === DEEPSEEK ? badJson() : ok(QWEN_PAID)));
    try {
      const out = await withEnv(env(DEEPSEEK, QWEN_PAID), () => generateProAnalysis(evidence));
      assert.equal(out.fromFallback, false, "JSON hong o primary phia fallback cuu duoc");
      assert.equal(out.metrics.validation_failed, true);
    } finally { globalThis.fetch = realFetch; }
  });

  await check("9. khong retry vo han: <= 2 attempt/model, <= MAX_CHAIN model", async () => {
    const captured = stubFetch(() => serverError());
    try {
      await withEnv(env(DEEPSEEK, `${QWEN_PAID},${GEMMA},google/gemma-4-31b-it:free`), () =>
        generateProAnalysis(evidence),
      );
    } finally { globalThis.fetch = realFetch; }
    const byModel = new Map<string, number>();
    for (const c of captured) byModel.set(c.model, (byModel.get(c.model) ?? 0) + 1);
    assert.ok(captured.length <= 6, `toi da 6 request (3 model x 2 attempt), thuc te ${captured.length}`);
    for (const [m, n] of byModel) {
      assert.ok(n <= 2, `model ${m} bi goi ${n} lan, vuot MAX_ATTEMPTS_PER_MODEL=2`);
    }
  });

  await check("10. budget tong: provider cham -> chain dung som hon 3 model x 2 attempt", async () => {
    // Moi request ton 1,5s. Budget 4s -> sau 1 call con 2,5s < MIN_CALL_BUDGET
    // (3s) -> chain phai dung, khong gom het 4 request nhu khi khong co budget.
    const captured = stubFetch(() => serverError(), 1500);
    try {
      await withEnv({ ...env(DEEPSEEK, `${QWEN_PAID},${GEMMA}`), PRO_ANALYSIS_CHAIN_BUDGET_MS: "4000" }, () =>
        generateProAnalysis(evidence),
      );
    } finally { globalThis.fetch = realFetch; }
    assert.ok(captured.length >= 1, "budget 4s van phai cho phep goi it nhat 1 lan");
    assert.ok(captured.length <= 2, `budget 4s phai dung sau <=2 request, thuc te ${captured.length}`);
  });

  await check("11. budget tong: het thi tra deterministic co budget_exhausted=true", async () => {
    stubFetch(() => serverError());
    try {
      const out = await withEnv({ ...env(DEEPSEEK, `${QWEN_PAID},${GEMMA}`), PRO_ANALYSIS_CHAIN_BUDGET_MS: "1" }, () =>
        generateProAnalysis(evidence),
      );
      assert.equal(out.fromFallback, true);
      assert.equal(out.fallbackReason, "chain_budget_exhausted");
      assert.equal(out.metrics.budget_exhausted, true, "phai danh dau budget het de phan biet voi model hong");
      assert.equal(out.metrics.guard_failed, false);
      assert.ok(out.analysis.summary.headline, "van phai co report deterministic");
    } finally { globalThis.fetch = realFetch; }
  });

  // ---------------------------------------------------------------
  // PHASE 6 — NGÂN SÁCH TOKEN THEO EVIDENCE 2026-10-04
  // JSON Pro thật cần ~5-6k output tokens (production: 5379). Trần 3000 cũ
  // cắt ngay attempt 1; attempt 2 thì hết budget chain trước khi sinh xong.
  // ---------------------------------------------------------------

  // Chuỗi đệm dùng chung: schema (lib/ai/schema.ts) cắt mỗi chuỗi ở 1200 ký
  // tự nên JSON lớn phải phân bố dài ra NHIỀU field nhỏ, không gộp một chuỗi.
  function padText(target: number): string {
    const unit =
      "Du lieu tham chieu khu vuc duoc tong hop tu cac tin dang cung phuong trong 90 ngay qua, chi mang tinh tham khao va can duoc xac minh bo sung. ";
    let s = "";
    while (s.length < target) s += unit;
    return s.slice(0, target).trimEnd();
  }

  await check("12. attempt 1 được cấp >= 6000 max_tokens (không còn trần 3000)", async () => {
    const captured = stubFetch(() => ok(DEEPSEEK));
    try {
      await withEnv(env(DEEPSEEK, QWEN_PAID), () => generateProAnalysis(evidence));
    } finally { globalThis.fetch = realFetch; }
    assert.ok(captured.length >= 1, "phải có ít nhất 1 request");
    const t1 = Number(captured[0].body.max_tokens);
    assert.ok(
      t1 >= 6000,
      `attempt 1 phải được cấp >= 6000 tokens để JSON ~5-6k hoàn tất trong một lần gọi, thực tế ${t1}`,
    );
    assert.equal(t1, maxOutputTokens({}), "attempt 1 phải đúng maxOutputTokens() (env-aware)");
  });

  // finish_reason=length nghĩa là content bị cắt ĐUÔI. Cho dù phần đã sinh ra
  // tình cờ là JSON hợp lệ, phần còn lại của report đã mất vĩnh viễn — phải bị
  // từ chối ở tầng transport (openrouter.ts), không được coi là success.
  await check("13. finish_reason=length + JSON hợp lệ vẫn không được coi là success", async () => {
    stubFetch((model) =>
      model === DEEPSEEK
        ? {
            status: 200,
            payload: {
              model: DEEPSEEK,
              choices: [{ message: { content: JSON.stringify(cleanAnalysis()) }, finish_reason: "length" }],
              usage: { prompt_tokens: 900, completion_tokens: 6000 },
            },
          }
        : ok(QWEN_PAID),
    );
    try {
      const out = await withEnv(env(DEEPSEEK, QWEN_PAID), () => generateProAnalysis(evidence));
      assert.equal(out.model, QWEN_PAID, "kết quả phải đến từ model khác, không phải content bị cắt");
      assert.equal(out.metrics.provider_errors.includes("provider_truncated"), true);
      assert.equal(out.metrics.fallback_used, false);
    } finally { globalThis.fetch = realFetch; }
  });

  // JSON hợp lệ dài (~5-6k output tokens, ca production: 5379) phải được chấp
  // nhận nguyên vẹn — không có cap kích thước nào được phép từ chối ở downstream.
  await check("14. JSON hợp lệ ~5-6k tokens (finish_reason=stop) được chấp nhận", async () => {
    const priceExplanation = padText(1100);
    const bigAnalysis: ProAnalysis = {
      ...cleanAnalysis(),
      summary: {
        headline: "Căn hộ 72m2 tại Cầu Giấy, giá 7,3 tỷ.",
        text: padText(1900),
        confidence: "medium",
      },
      highlights: Array.from({ length: 6 }, (_, i) => ({
        type: (i % 2 === 0 ? "positive" : "warning") as ProAnalysis["highlights"][number]["type"],
        title: `Điểm đáng chú ý ${i + 1}`,
        explanation: padText(1100),
        evidence_source: "listing",
      })),
      score_explanation: {
        summary: padText(950),
        strengths: Array.from({ length: 3 }, (_, i) => ({
          title: `Điểm mạnh ${i + 1}`,
          explanation: padText(1100),
          evidence_source: "listing",
        })),
        weaknesses: Array.from({ length: 2 }, (_, i) => ({
          title: `Điểm yếu ${i + 1}`,
          explanation: padText(1100),
          evidence_source: "listing",
        })),
      },
      next_steps: Array.from({ length: 6 }, (_, i) => ({
        priority: "medium" as const,
        title: `Bước kiểm tra ${i + 1}`,
        reason: padText(1100),
      })),
      limitations: [padText(1100), padText(1100), padText(1100)],
    };
    bigAnalysis.price_analysis.explanation = priceExplanation;
    const wire = JSON.stringify(bigAnalysis);
    // ~4 ký tự/token -> 20000 chars tương đương ~5k output tokens.
    assert.ok(wire.length >= 20000, `fixture phải tương đương ~5k+ tokens, thực tế ${wire.length} chars`);

    stubFetch(() => ({
      status: 200,
      payload: {
        model: DEEPSEEK,
        choices: [{ message: { content: wire }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1000, completion_tokens: 5379 },
      },
    }));
    try {
      const out = await withEnv(env(DEEPSEEK, QWEN_PAID), () => generateProAnalysis(evidence));
      assert.equal(out.fromFallback, false, "JSON đúng + đủ dài phải thành công, không rơi fallback");
      assert.equal(out.model, DEEPSEEK);
      assert.equal(out.metrics.output_tokens, 5379, "output_tokens phải lấy từ usage thật");
      assert.equal(
        out.analysis.price_analysis.explanation,
        priceExplanation,
        "nội dung dài phải được giữ nguyên qua parse (schema slice 1200 không đụng chuỗi dưới cap)",
      );
      assert.equal(out.analysis.highlights.length, 6);
    } finally { globalThis.fetch = realFetch; }
  });

  // ---------------------------------------------------------------
  // CONTRACT — trần có hạn, env-aware, không phá maxDuration
  // ---------------------------------------------------------------

  // Contract: budget mac dinh phai nho hon maxDuration 60s de con cho DB.
  await check("contract: budget mac dinh < maxDuration 60s va chua room cho DB", () => {
    const b = chainBudgetMs({});
    assert.ok(b > 0 && b < 60000, `budget mac dinh ${b}ms phai nam trong (0, 60000)`);
    // Trần "không tăng vô hạn": phải chừa ít nhất 10s cho auth + đọc DB +
    // save snapshot sau chain. 60s - 10s = 50s.
    assert.ok(b <= 50000, `budget mac dinh ${b}ms khong duoc vuot 50s (chua 10s cho DB trong maxDuration 60s)`);
    // Và vẫn đủ lớn để mở ít nhất 1 lần gọi.
    assert.ok(b >= MIN_CALL_BUDGET_MS, `budget mac dinh ${b}ms phai >= MIN_CALL_BUDGET_MS`);
  });

  await check("contract: retry budget > lan dau", () => {
    assert.ok(MAX_OUTPUT_TOKENS_RETRY > MAX_OUTPUT_TOKENS, "attempt sau rut phai co nhieu token hon");
  });

  await check("contract: cap mac dinh >= 6000 tokens (du cho JSON ~5-6k)", () => {
    assert.ok(
      maxOutputTokens({}) >= 6000,
      `cap mac dinh ${maxOutputTokens({})} phai >= 6000, nguoc lai JSON 5-6k bi cat ngay attempt 1`,
    );
  });

  await check("contract: env override token cap; retry luon > base ke ca khi env cau hinh nguoc", () => {
    // Mặc định khi không có env.
    assert.ok(maxOutputTokensRetry({}) > maxOutputTokens({}), "mac dinh retry > base");
    // Env hợp lệ.
    assert.equal(maxOutputTokens({ PRO_ANALYSIS_MAX_OUTPUT_TOKENS: "8000" }), 8000);
    assert.equal(maxOutputTokensRetry({ PRO_ANALYSIS_MAX_OUTPUT_TOKENS_RETRY: "12000" }), 12000);
    // Env sai định dạng / <= 0 -> dùng mặc định.
    assert.equal(maxOutputTokens({ PRO_ANALYSIS_MAX_OUTPUT_TOKENS: "abc" }), maxOutputTokens({}));
    assert.equal(maxOutputTokens({ PRO_ANALYSIS_MAX_OUTPUT_TOKENS: "-5" }), maxOutputTokens({}));
    // Env cấu hình NGƯỢC (retry < base) -> clamp để escalation vẫn có nghĩa.
    assert.equal(
      maxOutputTokensRetry({ PRO_ANALYSIS_MAX_OUTPUT_TOKENS_RETRY: "3000" }),
      maxOutputTokens({}) + 1,
      "retry phai duoc clamp > base khi env cau hinh nguoc",
    );
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
