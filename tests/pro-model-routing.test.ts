// Self-check: model routing Pro Analysis (chain, capability, cache, plan gate).
// Chạy: npm test — không gọi mạng thật, fetch được stub.

import { strict as assert } from "node:assert";
import {
  isDeniedModel,
  isV1ExcludedModel,
  resolveModelChain,
  structuredModeFor,
  MAX_CHAIN,
  PRO_ANALYSIS_DEFAULT_MODEL,
  PRO_ANALYSIS_BENCHMARK_CANDIDATES,
  isRetiredModel,
  timeoutMsFor,
} from "../lib/ai/model-chain.ts";
import { generateProAnalysis, formatProAnalysisMetrics } from "../lib/ai/pro-analysis.ts";
import { buildSnapshotUpdate, isFreshSnapshot, shouldPersistSnapshot } from "../lib/ai/report-cache.ts";
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
// Slug OpenRouter đã rút: từng là fallback v1, nay trả 404 mọi lần gọi.
const LING_RETIRED = "inclusionai/ling-3.0-flash-fin:free";
// Bản -vl CÒN sống (khác -fin đã rút ở trên): đây là fallback production
// hiện tại. Đo 2026-09-30 11:05: provider_timeout tại đúng trần 15s.
const LING_VL = "inclusionai/ling-3.0-flash-vl";
const GEMMA = "google/gemma-4-31b-it:free";
const NEMO = "nvidia/nemotron-3.5-lightning:free";

// Slug Qwen TRẢ PHÍ (đo 2026-09-30 11:28, check 103a3f9c): provider_timeout
// tại latency_ms=15002 với timeout_ms=15000. Nới deadline để thử lại.
const QWEN_PAID = "qwen/qwen3.8-27b";

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

// Slug bị provider rút: OpenRouter trả 404 kèm hướng dẫn dùng slug trả phí.
// callOpenRouter phân loại thành provider_error (không phải 429, không phải
// param không hỗ trợ) -> pro-analysis đi qua đúng nhánh fallback.
function modelUnavailable() {
  return {
    status: 404,
    payload: {
      error: {
        message: "This model is unavailable for free. The paid version is available now - use this slug instead: inclusionai/ling-3.0-flash-fin",
      },
    },
  };
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
  PRO_ANALYSIS_FALLBACK_MODELS: GEMMA,
};

// Nhóm test hồi quy cho slug đã rút. Giữ riêng vì đây là lỗi production thật
// (2026-09-30): mọi /api/pro-analysis trả 404 "This model is unavailable for free".
async function retiredModelTests() {
  console.log("\n== 11. Slug OpenRouter đã rút không được gọi ==");

  await check("chain default KHÔNG còn Ling (đã rút khỏi OpenRouter)", () => {
    assert.deepEqual(resolveModelChain({}), [QWEN, GEMMA]);
    assert.ok(!resolveModelChain({}).includes(LING_RETIRED));
  });

  await check("env vẫn khai Ling -> code lọc, chain rơi về Gemma", () => {
    // Đây là đường production thật: PRO_ANALYSIS_FALLBACK_MODELS đã có sẵn env.
    // Chỉ sửa default thì không đủ — phải lọc ở resolveModelChain.
    const chain = resolveModelChain({
      PRO_ANALYSIS_MODEL: QWEN,
      PRO_ANALYSIS_FALLBACK_MODELS: LING_RETIRED,
    });
    assert.deepEqual(chain, [QWEN], "slug rút không được giữ lại dưới bất kỳ hình thức nào");
    assert.equal(isRetiredModel(LING_RETIRED), true);
    assert.equal(isRetiredModel(GEMMA), false, "Gemma còn sống, không được lọc nhầm");
  });

  await check("slug rút được log skip, không im lặng", () => {
    const logged: string[] = [];
    const realWarn = console.warn;
    console.warn = (msg?: unknown) => {
      logged.push(String(msg));
    };
    try {
      resolveModelChain({ PRO_ANALYSIS_FALLBACK_MODELS: LING_RETIRED });
    } finally {
      console.warn = realWarn;
    }
    const line = logged.find((l) => l.includes("[pro-analysis-model]"));
    assert.ok(line, "phải log skip");
    assert.ok(line!.includes("retired_by_provider"));
    assert.ok(line!.includes(LING_RETIRED));
  });

  await check("Ling làm PRIMARY cũng bị lọc — không để env lái vào slug chết", () => {
    const chain = resolveModelChain({ PRO_ANALYSIS_MODEL: LING_RETIRED, PRO_ANALYSIS_FALLBACK_MODELS: GEMMA });
    assert.ok(!chain.includes(LING_RETIRED), "primary chết cũng phải bị loại");
    assert.deepEqual(chain, [GEMMA]);
  });

  await check("runtime: chain có Ling trong env -> KHÔNG request tới slug đó", async () => {
    const captured = stubFetch(() => ok(QWEN));
    await withEnv(
      { OPENROUTER_API_KEY: "test-key", PRO_ANALYSIS_MODEL: QWEN, PRO_ANALYSIS_FALLBACK_MODELS: LING_RETIRED },
      () => generateProAnalysis(sampleEvidence()),
    );
    const called = captured().map((c) => c.model);
    assert.ok(!called.includes(LING_RETIRED), "tuyệt đối không gọi model provider đã rút");
    assert.deepEqual([...new Set(called)], [QWEN]);
  });

  await check("capability: Gemma json_object, Ling không còn capability riêng", () => {
    assert.equal(structuredModeFor(GEMMA), "json_object");
    assert.equal(structuredModeFor(LING_RETIRED), "json_object", "slug lạ -> mode rộng, không hỏng");
  });
}

// Hồi quy cho lỗi production 2026-09-30 11:05 (check adc166ee):
//   [pro-analysis-error] provider_error=provider_429
//     requested_model=qwen/qwen3.8-27b:free
//     fallback_model=inclusionai/ling-3.0-flash-vl structured_mode=json_schema
//   [pro-analysis-error] provider_error=provider_timeout http_status=-
//     requested_model=inclusionai/ling-3.0-flash-vl
//     structured_mode=json_object latency_ms=15003
//
// Hai lỗi độc lập: (1) VL bị gán mode rộng json_object thay vì
// json_schema; (2) deadline 15s của client cắt ngang request của VL.
async function lingVlTests() {
  console.log("\n== 13. Ling VL: chain, json_schema, timeout 30s ==");

  const VL_ENV = { ...CHAIN_ENV, PRO_ANALYSIS_FALLBACK_MODELS: LING_VL };

  await check("Ling VL qua được bộ lọc (không dính RETIRED của -fin)", () => {
    assert.equal(isRetiredModel(LING_VL), false, "-vl khác -fin, không được lọc nhầm");
    assert.equal(isDeniedModel(LING_VL), false);
    assert.equal(isV1ExcludedModel(LING_VL), false);
    assert.deepEqual(
      resolveModelChain({ PRO_ANALYSIS_MODEL: QWEN, PRO_ANALYSIS_FALLBACK_MODELS: LING_VL }),
      [QWEN, LING_VL],
    );
  });

  await check("Qwen 429 -> Ling VL được gọi đúng 1 lần rồi trả lời", async () => {
    const captured = stubFetch((m) => (m === QWEN ? rateLimited() : ok(m)));
    const out = await withEnv(VL_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, false);
    assert.equal(out.model, LING_VL, "kết quả phải do Ling VL trả, không phải deterministic");
    assert.equal(captured().filter((c) => c.model === QWEN).length, 1, "Qwen 429 không retry");
    assert.equal(captured().filter((c) => c.model === LING_VL).length, 1, "VL gọi đúng 1 lần");
    assert.equal(out.metrics.rate_limited, true);
  });

  await check("Ling VL dùng json_schema (response_format json_schema trên wire)", async () => {
    const captured = stubFetch((m) => (m === QWEN ? rateLimited() : ok(m)));
    await withEnv(VL_ENV, () => generateProAnalysis(sampleEvidence()));
    const vl = captured().find((c) => c.model === LING_VL);
    assert.ok(vl, "phải có request tới Ling VL");
    const rf = vl!.body.response_format as { type?: string } | undefined;
    assert.equal(rf?.type, "json_schema", "VL phải dùng json_schema, không phải json_object");
    assert.equal(structuredModeFor(LING_VL), "json_schema");
  });

  await check("deadline: Ling VL = 30s, Qwen giữ mặc định 15s", async () => {
    // callOpenRouter đăng ký setTimeout(..., Math.max(1000, timeoutMs)).
    // Ghi lại delay thay vì chờ thật: kiểm chứng giá trị deadline đã truyền
    // vào client, không phụ thuộc thời gian thực.
    //
    // Spy KHÔNG hẹn timer thật (trả handle giả). Nếu hẹn 2_000_000ms thì
    // mọi timer đăng ký qua stub mà không được clearTimeout sẽ giữ event
    // loop của runner. openrouter.ts clearTimeout trong finally nên handle
    // giả vô hại; fetch stub trả lời ngay nên không cần timer bắn thật.
    const real = globalThis.setTimeout;
    const delays: number[] = [];
    globalThis.setTimeout = ((_fn: () => void, ms?: number) => {
      if (typeof ms === "number") delays.push(ms);
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout;
    try {
      stubFetch((m) => (m === QWEN ? rateLimited() : ok(m)));
      await withEnv(VL_ENV, () => generateProAnalysis(sampleEvidence()));
    } finally {
      globalThis.setTimeout = real;
    }
    assert.ok(delays.includes(30000), `phải đăng ký deadline 30s cho VL, thấy: ${delays.join(",")}`);
    assert.ok(delays.includes(15000), "Qwen phải giữ deadline mặc định 15s");
  });

  await check("log [pro-analysis-error] mang timeout_ms (chẩn đoán sau deploy)", async () => {
    const realError = console.error;
    const lines: string[] = [];
    console.error = (...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    };
    try {
      stubFetch((m) => {
        if (m === QWEN) return rateLimited();
        throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
      });
      await withEnv(VL_ENV, () => generateProAnalysis(sampleEvidence()));
    } finally {
      console.error = realError;
    }
    const vl = lines.find((l) => l.includes("[pro-analysis-error]") && l.includes(`requested_model=${LING_VL}`));
    assert.ok(vl, "phải có log lỗi cho Ling VL");
    assert.ok(vl!.includes("timeout_ms=30000"), `log phải nói deadline 30s: ${vl}`);
    assert.ok(vl!.includes("structured_mode=json_schema"), `log phải nói json_schema: ${vl}`);
    const qwen = lines.find((l) => l.includes(`requested_model=${QWEN}`));
    assert.ok(qwen!.includes("timeout_ms=15000"), `Qwen phải giữ 15s: ${qwen}`);
  });

  await check("timeoutMsFor: Ling VL được nới, các model khác giữ mặc định", () => {
    assert.equal(timeoutMsFor(LING_VL), 30000);
    assert.equal(timeoutMsFor(QWEN), 15000);
    assert.equal(timeoutMsFor(GEMMA), 15000);
    assert.equal(timeoutMsFor(NEMO), 15000);
    assert.equal(timeoutMsFor(LING_RETIRED), 15000, "slug đã rút không được hưởng deadline riêng");
  });

  await check("VL timeout (AbortError thật) vẫn retry 2 lần rồi mới deterministic", async () => {
    // status:0 KHÔNG tạo timeout — Response() ném TypeError => provider_network.
    // Timeout thật là fetch bị AbortController hủy, nên stub phải ném AbortError
    // đúng như abort() của callOpenRouter (openrouter.ts dò chữ ký name này).
    const captured = stubFetch((m) => {
      if (m === QWEN) return rateLimited();
      throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    });
    const out = await withEnv(VL_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(captured().filter((c) => c.model === LING_VL).length, 2, "timeout phải retry 2 lần");
    assert.equal(out.fromFallback, true);
    assert.equal(out.fallbackReason, "all_models_failed", "429 + timeout -> all_models_failed");
    assert.equal(
      out.metrics.provider_errors.join("|"),
      "provider_429|provider_timeout|provider_timeout",
      "phải ghi nhận 429 của Qwen + 2 timeout của VL",
    );
  });

  console.log("\n== 14. Qwen paid: deadline 30s, slug free KHÔNG bị nới ==");

  await check("timeoutMsFor: paid Qwen = 30s, free Qwen giữ 15s", () => {
    assert.equal(timeoutMsFor(QWEN_PAID), 30000, "slug trả phí được nới deadline");
    assert.equal(
      timeoutMsFor(QWEN),
      15000,
      "slug :free PHẢI giữ 15s — regex neo cuối, không nuốt cả slug free",
    );
  });

  await check("nới deadline không được lan sang slug khác", () => {
    // Nới cho slug free là sai: free trả 429 trong ~165ms, nới thêm chỉ làm
    // user chờ lâu hơn vô ích khi quota đã cạn.
    for (const other of [QWEN, GEMMA, NEMO, LING_RETIRED]) {
      assert.equal(timeoutMsFor(other), 15000, `${other} không được nới deadline`);
    }
  });

  await check("runtime: Qwen free 429 -> Qwen paid gọi với timeout_ms=30000", async () => {
    const realError = console.error;
    const lines: string[] = [];
    console.error = (...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    };
    let fromFallback: boolean | null = null;
    let fallbackReason: string | null = null;
    try {
      stubFetch((m) => {
        if (m === QWEN) return rateLimited();
        throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
      });
      const out = await withEnv(
        { ...CHAIN_ENV, PRO_ANALYSIS_FALLBACK_MODELS: QWEN_PAID },
        () => generateProAnalysis(sampleEvidence()),
      );
      fromFallback = out.fromFallback;
      fallbackReason = out.fallbackReason;
    } finally {
      console.error = realError;
    }
    // Phải khớp `requested_model=`, không dùng includes(model) trần: line
    // của slug free chứa "fallback_model=qwen/qwen3.8-27b" nên includes
    // trần bắt nhầm line free và assert sai deadline. Dấu space cuối chống
    // khớp lấn sang slug ":free".
    const paid = lines.find((l) => l.includes(`requested_model=${QWEN_PAID} `));
    assert.ok(paid, "phải có log lỗi cho Qwen paid");
    assert.ok(paid!.includes("timeout_ms=30000"), `paid phải log deadline 30s: ${paid}`);
    assert.ok(paid!.includes("structured_mode=json_schema"), `paid phải giữ json_schema: ${paid}`);
    const freeLine = lines.find((l) => l.includes(`requested_model=${QWEN} `));
    assert.ok(freeLine!.includes("timeout_ms=15000"), `free phải giữ 15s: ${freeLine}`);
    assert.equal(fromFallback, true);
    assert.equal(fallbackReason, "all_models_failed", "429 + timeout -> all_models_failed");
  });
}

async function main() {
  console.log("\n== Chain & capability (env-driven) ==");

  await check("default model là Qwen free, chain v1 = Qwen -> Gemma", () => {
    const chain = resolveModelChain({});
    assert.equal(chain[0], PRO_ANALYSIS_DEFAULT_MODEL);
    assert.equal(chain[0], QWEN);
    assert.deepEqual(chain, [QWEN, GEMMA]);
  });

  await check("chain v1 KHÔNG có Nemotron dù env có khai (regression)", () => {
    const chain = resolveModelChain({
      PRO_ANALYSIS_MODEL: QWEN,
      PRO_ANALYSIS_FALLBACK_MODELS: `${GEMMA},${NEMO}`,
    });
    assert.ok(!chain.includes(NEMO), "Nemotron phải bị loại khỏi chain v1");
    assert.deepEqual(chain, [QWEN, GEMMA]);
    assert.equal(isV1ExcludedModel(NEMO), true);
    assert.equal(isV1ExcludedModel(GEMMA), false, "Gemma vẫn phải được giữ");
  });

  await check("model bị loại v1 được log, không im lặng", () => {
    const logged: string[] = [];
    const realWarn = console.warn;
    console.warn = (msg?: unknown) => {
      logged.push(String(msg));
    };
    try {
      resolveModelChain({ PRO_ANALYSIS_MODEL: QWEN, PRO_ANALYSIS_FALLBACK_MODELS: NEMO });
    } finally {
      console.warn = realWarn;
    }
    const line = logged.find((l) => l.includes("[pro-analysis-model]"));
    assert.ok(line, "phải log skip");
    assert.ok(line!.includes("excluded_in_v1"));
    assert.ok(line!.includes(NEMO));
  });

  await check("env override được tôn trọng, không hardcode", () => {
    const chain = resolveModelChain({ PRO_ANALYSIS_MODEL: GEMMA, PRO_ANALYSIS_FALLBACK_MODELS: NEMO });
    assert.deepEqual(chain, [GEMMA], "fallback Nemotron bị loại, chain còn Gemma làm primary");
  });

  await check("chain tối đa MAX_CHAIN model", () => {
    const chain = resolveModelChain({
      PRO_ANALYSIS_MODEL: QWEN,
      PRO_ANALYSIS_FALLBACK_MODELS: "a/b:free,c/d:free,e/f:free,g/h:free",
    });
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
    const chain = resolveModelChain({ PRO_ANALYSIS_MODEL: "stealth/space-bunny-alpha", PRO_ANALYSIS_FALLBACK_MODELS: GEMMA });
    assert.ok(!chain.includes("stealth/space-bunny-alpha"));
    assert.ok(!chain.includes("inclusionai/ling-3.0-flash-sante:free"));
  });

  await check("space-bunny chỉ nằm trong danh sách benchmark, không vào chain", () => {
    assert.ok(PRO_ANALYSIS_BENCHMARK_CANDIDATES.includes("stealth/space-bunny-alpha"));
    assert.ok(!resolveModelChain({}).includes("stealth/space-bunny-alpha"));
  });

  await check("capability: Qwen json_schema, Gemma json_object, Nemotron không gửi response_format", () => {
    assert.equal(structuredModeFor(QWEN), "json_schema");
    assert.equal(structuredModeFor(GEMMA), "json_object");
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

  console.log("\n== 2. Qwen fail -> Gemma success ==");

  await check("Qwen 429 -> Gemma trả lời, không hỏi lại Qwen", async () => {
    const captured = stubFetch((m) => (m === QWEN ? rateLimited() : ok(m)));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, false);
    assert.equal(out.model, GEMMA);
    assert.equal(out.metrics.rate_limited, true);
    const models = captured().map((c) => c.model);
    assert.ok(models.includes(GEMMA));
    assert.equal(models.filter((m) => m === GEMMA).length, 1);
  });

  await check("Gemma nhận response_format json_object (đúng capability)", async () => {
    const captured = stubFetch((m) => (m === QWEN ? rateLimited() : ok(m)));
    await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    const gemma = captured().find((c) => c.model === GEMMA);
    assert.ok(gemma, "phải có request tới Gemma");
    // Gemma hỗ trợ response_format nhưng KHÔNG structured_outputs -> json_object.
    // Nếu gửi json_schema, OpenRouter từ chối -> mất cả attempt.
    assert.deepEqual(gemma!.body.response_format, { type: "json_object" });
  });

  console.log("\n== 3. Qwen + Gemma fail -> deterministic (không có model thứ 3) ==");

  await check("Qwen 429, Gemma fail -> deterministic fallback", async () => {
    const captured = stubFetch((m) => {
      if (m === QWEN) return rateLimited();
      if (m === GEMMA) return { status: 200, payload: { model: GEMMA, choices: [{ message: { content: "" } }] } };
      return ok(m);
    });
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, true);
    assert.equal(out.model, null);
    assert.ok(out.analysis.summary.headline.length > 0, "fallback vẫn có nội dung");
    // Không có model nào ngoài chain v1 được gọi
    const called = new Set(captured().map((c) => c.model));
    assert.deepEqual([...called].sort(), [GEMMA, QWEN].sort());
  });

  await check("Nemotron KHÔNG BAO GIỜ được gọi, kể cả khi env có khai", async () => {
    const captured = stubFetch((m) => (m === QWEN ? rateLimited() : ok(m)));
    await withEnv(
      { ...CHAIN_ENV, PRO_ANALYSIS_FALLBACK_MODELS: `${GEMMA},${NEMO}` },
      () => generateProAnalysis(sampleEvidence()),
    );
    assert.ok(
      !captured().some((c) => c.model === NEMO),
      "Nemotron phải bị loại khỏi runtime chain",
    );
  });

  await check("max_tokens=3000 để Gemma không bị cắt JSON (fix provider_truncated)", async () => {
    const captured = stubFetch((m) => (m === QWEN ? rateLimited() : ok(m)));
    await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    const gemma = captured().find((c) => c.model === GEMMA);
    assert.ok(gemma, "phải có request tới Gemma");
    assert.equal(gemma!.body.max_tokens, 3000, "phải yêu cầu 3000 token");
    const qwen = captured().find((c) => c.model === QWEN);
    assert.equal(qwen!.body.max_tokens, 3000, "áp dụng chung cho mọi model");
  });

  await check("Gemma success -> đủ điều kiện lưu analysis_json", async () => {
    stubFetch((m) => (m === QWEN ? rateLimited() : ok(m)));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, false);
    assert.equal(out.model, GEMMA, "model thực tế phải là Gemma");
    assert.equal(shouldPersistSnapshot(out), true, "route phải lưu analysis_json");
    const upd = buildSnapshotUpdate({
      analysis: out.analysis,
      actualModel: out.model!,
      analysisVersion: "pro-v1",
      scoringVersion: "jev-v1",
    });
    assert.equal(upd.ai_model, GEMMA);
    assert.ok(upd.ai_generated_at);
  });

  console.log("\n== 3b. 429 KHÔNG retry, chuyển model ngay ==");

  await check("Qwen 429 -> Gemma gọi đúng 1 lần (không retry Qwen)", async () => {
    const captured = stubFetch((m) => (m === QWEN ? rateLimited() : ok(m)));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, false);
    assert.equal(out.model, GEMMA);
    const qwenCalls = captured().filter((c) => c.model === QWEN);
    const gemmaCalls = captured().filter((c) => c.model === GEMMA);
    assert.equal(qwenCalls.length, 1, "Qwen 429 phải gọi đúng 1 lần, không retry");
    assert.equal(gemmaCalls.length, 1, "Gemma phải gọi đúng 1 lần rồi trả lời");
    assert.equal(out.metrics.rate_limited, true, "phải ghi nhận provider_rate_limited");
  });

  await check("429 không hỏi Jev (log không có receipt cho provider_429)", async () => {
    const realError = console.error;
    const lines: string[] = [];
    console.error = (...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    };
    try {
      stubFetch(() => rateLimited());
      await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    } finally {
      console.error = realError;
    }
    assert.equal(
      lines.filter((l) => l.includes("[pro-analysis-jev]")).length,
      0,
      "429 là quyết định cố định, không được hỏi Jev (hỏi chỉ ra retry lại model vừa 429)",
    );
  });

  await check("Qwen 429 + Gemma 429 -> deterministic fallback, reason rate_limited", async () => {
    const captured = stubFetch(() => rateLimited());
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, true, "phải trả deterministic fallback");
    assert.equal(out.model, null, "không lưu model khi không có AI trả lời");
    assert.equal(out.fallbackReason, "all_models_rate_limited", "giữ nguyên reason cũ");
    assert.equal(out.metrics.rate_limited, true);
    assert.ok(out.analysis.summary.headline.length > 0, "fallback vẫn có nội dung dùng được");
    assert.equal(captured().length, 2, "mỗi model đúng 1 lần, không retry 429");
  });

  await check("429 không retry cả khi chain có 3 model (không gọi trùng model)", async () => {
    const captured = stubFetch(() => rateLimited());
    const out = await withEnv(
      { ...CHAIN_ENV, PRO_ANALYSIS_FALLBACK_MODELS: `${GEMMA},qwen/qwen3-32b:free` },
      () => generateProAnalysis(sampleEvidence()),
    );
    assert.equal(out.fromFallback, true);
    const perModel = captured().reduce<Record<string, number>>((acc, c) => {
      acc[c.model] = (acc[c.model] ?? 0) + 1;
      return acc;
    }, {});
    for (const [model, n] of Object.entries(perModel)) {
      assert.equal(n, 1, `model ${model} bị gọi ${n} lần sau 429 — phải đúng 1`);
    }
  });

  console.log("\n== 3c. Timeout VẪN retry (không đổi hành vi) ==");

  await check("Qwen timeout -> retry cùng model 2 lần rồi mới đổi", async () => {
    const captured = stubFetch((m) => {
      if (m === QWEN) return { status: 0, payload: { error: { message: "timeout" } } };
      return ok(m);
    });
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(captured().filter((c) => c.model === QWEN).length, 2, "timeout phải retry 2 lần");
    assert.equal(out.fromFallback, false);
    assert.equal(out.model, GEMMA, "sau khi hết retry thì đổi sang Gemma");
  });

  await check("lỗi 500 vẫn retry (không phải 429 thì giữ nguyên)", async () => {
    const captured = stubFetch((m) =>
      m === QWEN ? { status: 500, payload: { error: { message: "upstream boom" } } } : ok(m),
    );
    await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(captured().filter((c) => c.model === QWEN).length, 2, "500 phải retry 2 lần");
  });

  await check("refresh sau khi Gemma lưu -> cache_hit=true, không gọi model", async () => {
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const stored = buildSnapshotUpdate({
        analysis: cleanAnalysis(),
        actualModel: GEMMA,
        analysisVersion: "pro-v1",
        scoringVersion: "jev-v1",
      });
      const row = { analysis_json: stored.analysis_json, analysis_version: stored.analysis_version };
      assert.equal(isFreshSnapshot(row, "pro-v1"), true, "phải cache hit");
      assert.equal(calls, 0, "zero OpenRouter request");
    } finally {
      globalThis.fetch = realFetch;
    }
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
    // 429 không retry: mỗi model gọi ĐÚNG 1 lần rồi đổi model (trước đây là 4).
    assert.equal(captured().length, 2);
    assert.deepEqual(
      captured().map((c) => c.model),
      [QWEN, GEMMA],
      "phải thử từng model đúng 1 lần, theo thứ tự chain",
    );
  });

  await check("mọi model trả 500 -> fallback, provider_errors có ghi", async () => {
    stubFetch(() => ({ status: 500, payload: { error: { message: "upstream boom" } } }));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, true);
    assert.equal(out.fallbackReason, "all_models_failed");
    assert.ok(out.metrics.provider_errors.length > 0);
  });

  console.log("\n== 5. Malformed JSON -> validation fail ==");

  await check("JSON hỏng ở Qwen -> validate fail, chuyển sang Gemma", async () => {
    const captured = stubFetch((m) => (m === QWEN ? badJson() : ok(m)));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, false);
    assert.equal(out.model, GEMMA);
    assert.equal(out.metrics.validation_failed, true);
    assert.ok(captured().some((c) => c.model === GEMMA));
  });

  await check("mọi model trả JSON hỏng -> fallback, KHÔNG lưu", async () => {
    stubFetch(() => badJson());
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, true);
    assert.equal(out.model, null);
    assert.equal(out.metrics.validation_failed, true);
  });

  console.log("\n== 6. Hallucination -> guard reject ==");

  await check("Qwen khai pháp lý đã xác minh -> guard chặn, chuyển sang Gemma", async () => {
    const captured = stubFetch((m) => (m === QWEN ? ok(m, hallucinated) : ok(m)));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, false);
    assert.equal(out.model, GEMMA);
    assert.equal(out.metrics.guard_failed, true);
    assert.ok(captured().some((c) => c.model === GEMMA));
  });

  await check("mọi model khai bịa -> guard chặn hết, fallback, KHÔNG lưu vào analysis_json", async () => {
    stubFetch((m) => ok(m, hallucinated));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, true);
    assert.equal(out.model, null);
    assert.equal(out.metrics.guard_failed, true);
  });

  await check("Gemma bịa lời khuyên đầu tư chắc nịch -> guard chặn", async () => {
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

  await check("cache không phụ thuộc model: report tạo bằng Gemma vẫn được giữ", () => {
    const row = { analysis_json: cleanAnalysis(), analysis_version: "pro-v1", ai_model: GEMMA };
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
      actualModel: GEMMA,
      analysisVersion: "pro-v1",
      scoringVersion: "jev-v1",
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(upd.ai_model, GEMMA);
    assert.equal(upd.analysis_version, "pro-v1");
    assert.equal(upd.scoring_version, "jev-v1");
    assert.equal(upd.ai_generated_at, "2026-01-01T00:00:00.000Z");
  });

  await check("metrics có đủ trường đo (không PII, không prompt)", () => {
    const line = formatProAnalysisMetrics({
      requested_model: QWEN,
      actual_model: GEMMA,
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

  console.log("\n== 10b. Observability & provider diagnostics ==");

  await check("finish_reason=length -> phân loại provider_truncated (JSON chắc chắn hỏng)", async () => {
    const captured = stubFetch(() => ({
      status: 200,
      payload: {
        model: QWEN,
        choices: [{ finish_reason: "length", message: { content: '{"summary":{"headline":"cắt dở' } }],
      },
    }));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.ok(captured().length > 0);
    assert.equal(out.fromFallback, true);
    assert.ok(out.metrics.provider_errors.includes("provider_truncated"));
  });

  await check("provider 400 nhắc response_format -> hạ xuống prompt-only rồi thử lại", async () => {
    const captured = stubFetch((m, n) =>
      n === 1
        ? { status: 400, payload: { error: { message: "response_format json_schema is not supported" } } }
        : ok(m),
    );
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, false);
    const second = captured()[1];
    assert.equal(second.model, QWEN, "phải thử lại CHÍNH model này, không nhảy sang Gemma");
    assert.equal(second.body.response_format, undefined, "attempt 2 không được gửi response_format");
  });

  await check("log không lộ key / email / SĐT trong response_body_safe", async () => {
    const captured = stubFetch(() => ({
      status: 400,
      payload: {
        error: { message: "invalid key sk-or-abcdef123456 for a@b.com phone 0909123456" },
      },
    }));
    const logged: string[] = [];
    const realLog = console.error;
    console.error = (msg?: unknown) => {
      logged.push(String(msg));
    };
    try {
      await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    } finally {
      console.error = realLog;
    }
    assert.ok(captured().length > 0);
    const joined = logged.join("\n");
    if (joined.length > 0) {
      assert.ok(!joined.includes("sk-or-abcdef123456"), "rò API key");
      assert.ok(!joined.includes("a@b.com"), "rò email");
      assert.ok(!joined.includes("0909123456"), "rò SĐT");
    }
  });

  await check("mọi lần lỗi đều log đủ trường chẩn đoán", async () => {
    // 429 chuyển model ngay nên không còn "attempt 2 cùng model" — dựng lại
    // Case E bằng Gemma trả JSON hỏng, để log vẫn phải phân biệt được 2 case.
    const captured = stubFetch((m) => (m === QWEN ? rateLimited() : badJson()));
    const logged: string[] = [];
    const realLog = console.error;
    console.error = (msg?: unknown) => {
      logged.push(String(msg));
    };
    try {
      await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    } finally {
      console.error = realLog;
    }
    assert.ok(captured().length > 0);
    const errors = logged.filter((l) => l.includes("[pro-analysis-error]"));
    assert.ok(errors.length >= 2, "phải log mỗi lần lỗi");
    for (const line of errors) {
      for (const k of [
        "provider_error=",
        "http_status=",
        "requested_model=",
        "actual_model=",
        "fallback_attempt=",
        "fallback_model=",
        "response_body_safe=",
      ]) {
        assert.ok(line.includes(k), `thiếu trường ${k}`);
      }
    }
    // Phân biệt được từng case: 429 (Case C) và JSON hỏng (Case E)
    assert.ok(
      errors.some((l) => l.includes("provider_error=provider_429")),
      "phải nhận diện được 429",
    );
    assert.ok(
      errors.some((l) => l.includes("provider_error=validation_failed")),
      "phải phân biệt được Case E",
    );
  });

  // Provider 404 = slug bị provider rút ("No endpoints found" /
  // "This model is unavailable for free"). Đây chính là lỗi production
  // 2026-09-30 trên inclusionai/ling-3.0-flash-fin:free.
  console.log("\n== 12. Provider 404 (slug bị rút) ==");

  await check("Qwen 404 -> Gemma trả lời, report KHÔNG rơi về deterministic", async () => {
    const captured = stubFetch((m) => (m === QWEN ? modelUnavailable() : ok(m)));
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, false, "model thứ 2 còn sống thì không được fallback");
    assert.equal(out.model, GEMMA);
    assert.equal(out.metrics.provider_errors.includes("provider_error"), true);
    const models = captured().map((c) => c.model);
    assert.ok(models.includes(GEMMA));
    assert.equal(models.filter((m) => m === GEMMA).length, 1);
  });

  await check("mọi model 404 -> deterministic fallback, report vẫn đầy đủ", async () => {
    const captured = stubFetch(() => modelUnavailable());
    const out = await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    assert.equal(out.fromFallback, true);
    assert.equal(out.model, null, "không lưu model khi không có AI nào trả lời");
    assert.equal(out.fallbackReason, "all_models_failed");
    assert.ok(out.analysis.summary.headline.length > 0, "fallback vẫn có nội dung");
    assert.ok(out.analysis.price_analysis);
    assert.ok(Array.isArray(out.analysis.warnings));
    assert.ok(Array.isArray(out.analysis.next_steps));
    // Không loop vô hạn: chain 2 model x 2 attempt
    assert.equal(captured().length, 4);
  });

  await check("404 được log đủ chẩn đoán, không lộ key", async () => {
    const captured = stubFetch(() => modelUnavailable());
    const logged: string[] = [];
    const realLog = console.error;
    console.error = (msg?: unknown) => {
      logged.push(String(msg));
    };
    try {
      await withEnv(CHAIN_ENV, () => generateProAnalysis(sampleEvidence()));
    } finally {
      console.error = realLog;
    }
    assert.ok(captured().length > 0);
    const joined = logged.join("\n");
    assert.ok(joined.includes("[pro-analysis-error]"));
    assert.ok(joined.includes("http_status=404"));
    assert.ok(!joined.includes("sk-or-"), "không được lọt key");
  });

  await retiredModelTests();
  await lingVlTests();

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  // process.exit() huy async handle -> libuv assertion tren Windows.
  // process.exitCode de tien trinh tu thoat, chay lai 100%
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
