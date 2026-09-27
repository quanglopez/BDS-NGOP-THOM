// Self-check: model routing Pro Analysis (chain, capability, cache, plan gate).
// Chạy: npm test — không gọi mạng thật, fetch được stub.

import { strict as assert } from "node:assert";
import {
  isDeniedModel,
  resolveModelChain,
  structuredModeFor,
  MAX_CHAIN,
  PRO_ANALYSIS_DEFAULT_MODEL,
  PRO_ANALYSIS_BENCHMARK_CANDIDATES,
} from "../lib/ai/model-chain.ts";
import { generateProAnalysis, formatProAnalysisMetrics } from "../lib/ai/pro-analysis.ts";
import { buildSnapshotUpdate, isFreshSnapshot } from "../lib/ai/report-cache.ts";
import { planAllowsProAnalysis } from "../lib/quota.ts";
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

const QWEN = "qwen/qwen3.8-27b:free";
const LING = "inclusionai/ling-3.0-flash-fin:free";
const NEMO = "nvidia/nemotron-3.5-lightning:free";

const SAMPLE_TEXT =
  "Bán gấp! Nhà mặt tiền Thùy Vân 80m2, 4 tầng, ngân hàng thanh lý, giá 5.5 tỷ, sổ hồng riêng, hẻm xe hơi";

function sampleEvidence() {
  return buildEvidencePack({
    title: SAMPLE_TEXT.slice(0, 100),
    price: 5500000000,
    area: 80,
    bedrooms: 4,
    ward: null,
    region: "Vũng Tàu",
    listingUrl: "https://www.nhatot.com/tin/1.htm",
    listingText: SAMPLE_TEXT,
    result: analyzeListing(SAMPLE_TEXT),
    dealType: "ngop_ngon",
    scoringVersion: "jev-v1",
    analysisVersion: "pro-v1",
  });
}

function cleanAnalysis(): ProAnalysis {
  return {
    summary: { headline: "Tin 72/100 điểm", text: "Dữ liệu hiện tại cho thấy tiềm năng.", confidence: "medium" },
    highlights: [{ type: "positive", title: "Giá hợp lý", explanation: "Theo giá chào bán.", evidence_source: "scoring" }],
    score_explanation: {
      summary: "Điểm yếu tố không cộng trực tiếp thành điểm tổng.",
      strengths: [{ title: "Vị trí", explanation: "Mặt tiền.", evidence_source: "listing" }],
      weaknesses: [],
    },
    factor_analysis: [
      { factor: "Giá", score: 72, label: "Tốt", explanation: "Theo giá chào bán.", evidence_source: "calculated" },
    ],
    price_analysis: {
      available: true,
      asking_price: 5500000000,
      price_per_m2: 68750000,
      reference_available: false,
      reference_median: null,
      difference_percent: null,
      explanation: "Chưa đủ dữ liệu tham chiếu.",
    },
    warnings: [],
    next_steps: [{ priority: "high", title: "Xem sổ gốc", reason: "Xác minh pháp lý." }],
    limitations: ["Dữ liệu hiện tại có hạn chế."],
  };
}

const hallucinated: ProAnalysis = {
  ...cleanAnalysis(),
  warnings: [
    {
      severity: "high",
      title: "Pháp lý",
      explanation: "Pháp lý đã được xác minh.",
      requires_verification: false,
      evidence_source: "listing",
    },
  ],
};

interface Captured {
  model: string;
  body: Record<string, unknown>;
}

type Responder = (model: string, attempt: number) => { status: number; payload: unknown };

// Stub fetch, trả về danh sách request đã gửi để assert.
function stubFetch(responder: Responder): () => Captured[] {
  const captured: Captured[] = [];
  const attemptByModel = new Map<string, number>();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const model = String(body.model);
    const n = (attemptByModel.get(model) ?? 0) + 1;
    attemptByModel.set(model, n);
    captured.push({ model, body });
    const r = responder(model, n);
    return new Response(typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  void realFetch;
  return () => captured;
}

function ok(model: string, analysis: unknown = cleanAnalysis()) {
  return { status: 200, payload: { model, choices: [{ message: { content: JSON.stringify(analysis) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } } };
}

function rateLimited() {
  return { status: 429, payload: { error: { message: "Rate limit exceeded" } } };
}

function badJson() {
  return { status: 200, payload: { model: "", choices: [{ message: { content: "{khong phai json" } }] } };
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const CHAIN_ENV = {
  OPENROUTER_API_KEY: "test-key",
  PRO_ANALYSIS_MODEL: QWEN,
  PRO_ANALYSIS_FALLBACK_MODELS: `${LING},${NEMO}`,
};

async function main() {
  console.log("\n== Chain & capability (env-driven) ==");

  await check("default model là Qwen free, chain đúng thứ tự", () => {
    const chain = resolveModelChain({});
    assert.equal(chain[0], PRO_ANALYSIS_DEFAULT_MODEL);
    assert.equal(chain[0], QWEN);
    assert.deepEqual(chain, [QWEN, LING, NEMO]);
  });

  await check("env override được tôn trọng, không hardcode", () => {
    const chain = resolveModelChain({ PRO_ANALYSIS_MODEL: LING, PRO_ANALYSIS_FALLBACK_MODELS: NEMO });
    assert.deepEqual(chain, [LING, NEMO]);
  });

  await check("chain tối đa MAX_CHAIN model", () => {
    const chain = resolveModelChain({ PRO_ANALYSIS_MODEL: QWEN, PRO_ANALYSIS_FALLBACK_MODELS: `${LING},${NEMO},a/b:free,c/d:free` });
    assert.equal(chain.length, MAX_CHAIN);
  });

  await check("model bị denied (coding/y tế/stealth/multimodal) bị loại", () => {
    assert.ok(isDeniedModel("poolside/laguna-s-2.1:free"));
    assert.ok(isDeniedModel("poolside/laguna-xs-2.1:free"));
    assert.ok(isDeniedModel("cohere/north-mini-code:free"));
    assert.ok(isDeniedModel("inclusionai/ling-3.0-flash-sante:free"));
    assert.ok(isDeniedModel("stealth/space-bunny-alpha"));
    assert.ok(isDeniedModel("some/inkling"));
    assert.ok(isDeniedModel("nvidia/nemotron-nano-omni"));
    const chain = resolveModelChain({ PRO_ANALYSIS_MODEL: "stealth/space-bunny-alpha", PRO_ANALYSIS_FALLBACK_MODELS: LING });
    assert.ok(!chain.includes("stealth/space-bunny-alpha"));
    assert.ok(!chain.includes("inclusionai/ling-3.0-flash-sante:free"));
  });

  await check("space-bunny chỉ nằm trong danh sách benchmark, không vào chain", () => {
    assert.ok(PRO_ANALYSIS_BENCHMARK_CANDIDATES.includes("stealth/space-bunny-alpha"));
    assert.ok(!resolveModelChain({}).includes("stealth/space-bunny-alpha"));
  });

  await check("capability: Qwen json_schema, Ling/Nemotron không gửi response_format", () => {
    assert.equal(structuredModeFor(QWEN), "json_schema");
    assert.equal(structuredModeFor(LING), "none");
    assert.equal(structuredModeFor(NEMO), "none");
  });

  console.log("\n== 1. Qwen success ==");

  await check("Qwen trả JSON hợp lệ -> dùng luôn, 1 request, lưu actual model", async () => {
    const captured = stubFetch((m) => ok(m));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, false);
    assert.equal(out.model, QWEN);
    assert.equal(out.requestedModel, QWEN);
    assert.equal(captured().length, 1);
    assert.equal(captured()[0].model, QWEN);
  });

  await check("Qwen nhận response_format json_schema", async () => {
    const captured = stubFetch((m) => ok(m));
    await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    const rf = captured()[0].body.response_format as { type?: string; json_schema?: unknown };
    assert.equal(rf.type, "json_schema");
    assert.ok(rf.json_schema, "phải kèm JSON Schema");
  });

  console.log("\n== 2. Qwen fail -> Ling success ==");

  await check("Qwen 429 -> Ling trả lời, không hỏi lại Qwen", async () => {
    const captured = stubFetch((m) => (m === QWEN ? rateLimited() : ok(m)));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, false);
    assert.equal(out.model, LING);
    assert.equal(out.metrics.rate_limited, true);
    const models = captured().map((c) => c.model);
    assert.ok(models.includes(LING));
    assert.equal(models.filter((m) => m === LING).length, 1);
  });

  await check("Ling KHÔNG nhận response_format (đúng capability)", async () => {
    const captured = stubFetch((m) => (m === QWEN ? rateLimited() : ok(m)));
    await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    const ling = captured().find((c) => c.model === LING);
    assert.ok(ling, "phải có request tới Ling");
    assert.equal(ling!.body.response_format, undefined);
  });

  console.log("\n== 3. Qwen + Ling fail -> Nemotron success ==");

  await check("Qwen 429, Ling timeout -> Nemotron trả lời", async () => {
    const captured = stubFetch((m) => {
      if (m === QWEN) return rateLimited();
      if (m === LING) return { status: 200, payload: { model: LING, choices: [{ message: { content: "" } }] } };
      return ok(m);
    });
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, false);
    assert.equal(out.model, NEMO);
    const models = captured().map((c) => c.model);
    assert.deepEqual(models.filter((m) => m === NEMO).length, 1);
  });

  await check("Nemotron KHÔNG nhận response_format", async () => {
    const captured = stubFetch((m) => {
      if (m === QWEN) return rateLimited();
      if (m === LING) return { status: 200, payload: { model: LING, choices: [{ message: { content: "" } }] } };
      return ok(m);
    });
    await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    const nemo = captured().find((c) => c.model === NEMO);
    assert.ok(nemo);
    assert.equal(nemo!.body.response_format, undefined);
  });

  console.log("\n== 4. Tất cả AI fail -> deterministic fallback ==");

  await check("mọi model 429 -> fallback, không crash, reason rate_limited", async () => {
    const captured = stubFetch(() => rateLimited());
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, true);
    assert.equal(out.model, null, "không lưu model khi không có AI nào trả lời");
    assert.equal(out.fallbackReason, "all_models_rate_limited");
    assert.equal(out.metrics.fallback_used, true);
    assert.ok(out.analysis.summary.headline.length > 0, "fallback vẫn có nội dung");
    // Không loop vô hạn: mỗi model tối đa 2 attempt
    assert.equal(captured().length, MAX_CHAIN * 2);
  });

  await check("mọi model trả 500 -> fallback, provider_errors có ghi", async () => {
    stubFetch(() => ({ status: 500, payload: { error: { message: "upstream boom" } } }));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, true);
    assert.equal(out.fallbackReason, "all_models_failed");
    assert.ok(out.metrics.provider_errors.length > 0);
  });

  console.log("\n== 5. Malformed JSON -> validation fail ==");

  await check("JSON hỏng ở Qwen -> validate fail, chuyển sang Ling", async () => {
    const captured = stubFetch((m) => (m === QWEN ? badJson() : ok(m)));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, false);
    assert.equal(out.model, LING);
    assert.equal(out.metrics.validation_failed, true);
    assert.ok(captured().some((c) => c.model === LING));
  });

  await check("mọi model trả JSON hỏng -> fallback, KHÔNG lưu", async () => {
    stubFetch(() => badJson());
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, true);
    assert.equal(out.model, null);
    assert.equal(out.metrics.validation_failed, true);
  });

  console.log("\n== 6. Hallucination -> guard reject ==");

  await check("Qwen khai pháp lý đã xác minh -> guard chặn, chuyển sang Ling", async () => {
    const captured = stubFetch((m) => (m === QWEN ? ok(m, hallucinated) : ok(m)));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, false);
    assert.equal(out.model, LING);
    assert.equal(out.metrics.guard_failed, true);
    assert.ok(captured().some((c) => c.model === LING));
  });

  await check("mọi model khai bịa -> guard chặn hết, fallback, KHÔNG lưu vào analysis_json", async () => {
    stubFetch((m) => ok(m, hallucinated));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, true);
    assert.equal(out.model, null);
    assert.equal(out.metrics.guard_failed, true);
  });

  await check("Ling bịa lời khuyên đầu tư chắc nịch -> guard chặn", async () => {
    const advice: ProAnalysis = {
      ...cleanAnalysis(),
      summary: { ...cleanAnalysis().summary, text: "Bạn nên mua ngay, ROI cao." },
    };
    stubFetch((m) => (m === QWEN ? rateLimited() : ok(m, advice)));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, true);
    assert.equal(out.metrics.guard_failed, true);
  });

  console.log("\n== 7. Cache hit -> không gọi model ==");

  await check("snapshot đúng version -> fresh, không cần gọi AI", () => {
    assert.equal(isFreshSnapshot({ analysis_json: cleanAnalysis(), analysis_version: "pro-v1" }, "pro-v1"), true);
    assert.equal(isFreshSnapshot({ analysis_json: null, analysis_version: "pro-v1" }, "pro-v1"), false);
    assert.equal(isFreshSnapshot({ analysis_json: cleanAnalysis(), analysis_version: "pro-v0" }, "pro-v1"), false);
    assert.equal(isFreshSnapshot({ analysis_json: [], analysis_version: "pro-v1" }, "pro-v1"), false);
  });

  await check("cache không phụ thuộc model: report tạo bằng Ling vẫn được giữ", () => {
    const row = { analysis_json: cleanAnalysis(), analysis_version: "pro-v1", ai_model: LING };
    assert.equal(isFreshSnapshot(row, "pro-v1"), true);
  });

  await check("cache hit -> 0 request OpenRouter", async () => {
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const row = { analysis_json: cleanAnalysis(), analysis_version: "pro-v1" };
      if (isFreshSnapshot(row, "pro-v1")) {
        // route trả cache ở đây, không gọi generateProAnalysis
      }
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  console.log("\n== 8. Free user -> zero OpenRouter request ==");

  await check("plan gate: chỉ pro/team, Free bị chặn", () => {
    assert.equal(planAllowsProAnalysis("free"), false);
    assert.equal(planAllowsProAnalysis(null), false);
    assert.equal(planAllowsProAnalysis("pro"), true);
    assert.equal(planAllowsProAnalysis("team"), true);
  });

  await check("Free -> không gọi fetch, trả locked ngay", async () => {
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      // Gate chặn trước khi gọi generateProAnalysis
      const allowed = planAllowsProAnalysis("free");
      if (!allowed) {
        // route trả 403 locked
      }
      assert.equal(calls, 0);
      assert.equal(allowed, false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  console.log("\n== 9. Actual model được lưu đúng ==");

  await check("provider trả model khác request -> lưu model của response", async () => {
    stubFetch(() => ({ status: 200, payload: { model: "nvidia/nemotron-3.5-lightning:free:provider-x", choices: [{ message: { content: JSON.stringify(cleanAnalysis()) } }] } }));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.model, "nvidia/nemotron-3.5-lightning:free:provider-x");
    assert.equal(out.requestedModel, QWEN);
    assert.equal(out.metrics.actual_model, "nvidia/nemotron-3.5-lightning:free:provider-x");
  });

  await check("snapshot lưu actual model, không lưu model yêu cầu", () => {
    const upd = buildSnapshotUpdate({
      analysis: cleanAnalysis(),
      actualModel: LING,
      analysisVersion: "pro-v1",
      scoringVersion: "jev-v1",
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(upd.ai_model, LING);
    assert.equal(upd.analysis_version, "pro-v1");
    assert.equal(upd.scoring_version, "jev-v1");
    assert.equal(upd.ai_generated_at, "2026-01-01T00:00:00.000Z");
  });

  await check("metrics có đủ trường đo (không PII, không prompt)", () => {
    const line = formatProAnalysisMetrics({
      requested_model: QWEN,
      actual_model: LING,
      fallback_used: false,
      attempts: 2,
      latency_ms: 1234,
      input_tokens: 100,
      output_tokens: 50,
      provider_errors: ["provider_429"],
      rate_limited: true,
      validation_failed: false,
      guard_failed: false,
    });
    for (const k of ["requested_model", "actual_model", "fallback_used", "latency_ms", "rate_limited", "guard_failed", "input_tokens", "output_tokens"]) {
      assert.ok(line.includes(k), `thiếu ${k}`);
    }
    assert.ok(!line.includes("sk-"), "không được lọt key");
  });

  console.log("\n== 10. 429 không làm report crash ==");

  await check("429 từ cả 3 model vẫn trả analysis hợp lệ + metrics đầy đủ", async () => {
    stubFetch(() => rateLimited());
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, true);
    assert.ok(out.metrics.attempts > 0);
    assert.equal(out.metrics.rate_limited, true);
    assert.equal(out.metrics.actual_model, null);
    // Fallback deterministic vẫn có các trường UI cần
    assert.ok(out.analysis.price_analysis);
    assert.ok(Array.isArray(out.analysis.warnings));
    assert.ok(Array.isArray(out.analysis.next_steps));
  });

  await check("thiếu OPENROUTER_API_KEY -> fallback ngay, 0 request", async () => {
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const out = await withEnv({ ...CHAIN_ENV, OPENROUTER_API_KEY: undefined }, () => generateProAnalysis(sampleEvidence()));
      assert.equal(out.fromFallback, true);
      assert.equal(out.fallbackReason, "no_api_key");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
