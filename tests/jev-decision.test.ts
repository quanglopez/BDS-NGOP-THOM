// Test cho Jev decision contract (lib/ai/jev-decision.ts).
// Chay: npm test — KHONG goi mang that. Phan "shadow/offline" chay duoc luon.
// Phan "live" chi chay khi TYPESAFE_API_KEY that, xem README_JEV.md.

import { strict as assert } from "node:assert";
import { jsonResponse, sseResponse } from "./openrouter-sse.ts";
import {
  PRO_ROUTE_OPTIONS,
  PRO_ROUTE_MIN_CONFIDENCE,
  PRO_ROUTE_MAX_ATTEMPTS,
  askProRoute,
  defaultRoute,
  forbiddenKeysIn,
  formatJevDecisionReceipt,
  jevDecisionEnabled,
  jevDecisionShadow,
  rankProRoute,
  type ProFailureKind,
  type ProFailureState,
  type ProRouteOption,
} from "../lib/ai/jev-decision.ts";
import { resolveModelChain } from "../lib/ai/model-chain.ts";
import { generateProAnalysis } from "../lib/ai/pro-analysis.ts";
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
const GEMMA = "google/gemma-4-31b-it:free";

const SAMPLE_TEXT =
  "Bán gấp! Nhà mặt tiền Thủy Vân 80m2, 4 tầng, ngân hàng thanh lý, giá 5.5 tỷ, sổ hồng riêng, hầm xe hơi";

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
      explanation: "Chưa có dữ liệu tham chiếu.",
    },
    warnings: [],
    next_steps: [{ priority: "high", title: "Xem sổ gốc", reason: "Xác minh pháp lý." }],
    limitations: ["Dữ liệu hiện tại có hạn chế."],
  };
}

function state(over: Partial<ProFailureState> = {}): ProFailureState {
  return {
    attempt: 1,
    modelIndex: 0,
    model: QWEN,
    failure: "guard_failed",
    priorModels: [],
    priorFailures: [],
    guardReasons: ["claim đã xác minh không có nguồn"],
    modelsRemaining: 1,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// A. TƯƠNG THÍCH — JEV TẮT / KHÔNG CÓ KEY => Y HỆT CODE CŨ
// ---------------------------------------------------------------------------

async function compatibilityTests() {
  console.log("\n== A. defaultRoute phải khớp ĐÚNG vòng loop cũ ==");

  await check("attempt 1 -> retry (giống continue cũ)", () => {
    assert.equal(defaultRoute(state({ attempt: 1 })), "retry_same_model");
  });

  await check("attempt 2, còn model sau -> switch_model", () => {
    assert.equal(defaultRoute(state({ attempt: 2, modelsRemaining: 1 })), "switch_model");
  });

  await check("attempt 2, hết chain -> deterministic_fallback", () => {
    assert.equal(defaultRoute(state({ attempt: 2, modelsRemaining: 0 })), "deterministic_fallback");
  });

  // Quét toàn bộ tổ hợp: defaultRoute KHÔNG được phá vỡ bất kỳ tổ hợp nào
  // so với quy tắc "retry cho tới MAX_ATTEMPTS, rồi đổi model, hết thì fallback".
  await check("quét 216 tổ hợp: khớp 100% quy tắc cũ", () => {
    const failures: ProFailureKind[] = [
      "provider_429",
      "validation_failed",
      "guard_failed",
      "provider_truncated",
      "provider_empty_content",
    ];
    let checked = 0;
    for (const failure of failures) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        for (let remaining = 0; remaining <= 2; remaining++) {
          for (const priorCount of [0, 1]) {
            const s = state({
              attempt,
              modelsRemaining: remaining,
              failure,
              priorFailures: priorCount > 0 ? [failure] : [],
            });
            const expected: ProRouteOption =
              attempt < PRO_ROUTE_MAX_ATTEMPTS
                ? "retry_same_model"
                : remaining > 0
                  ? "switch_model"
                  : "deterministic_fallback";
            assert.equal(
              defaultRoute(s),
              expected,
              `sai ở attempt=${attempt} remaining=${remaining} failure=${failure} prior=${priorCount}`,
            );
            checked++;
          }
        }
      }
    }
    assert.equal(checked, 90, "phải quét đúng số tổ hợp đã nêu");
  });

  await check("JEV_DECISION=off -> skipped, không gọi mạng", async () => {
    const r = await askProRoute(state(), { JEV_DECISION: "off" });
    assert.equal(r.mode, "skipped");
    assert.equal(r.used_jev_answer, false);
    assert.equal(r.route, "retry_same_model", "vẫn theo đường cũ");
    assert.equal(r.latency_ms, 0, "không gọi mạng nên latency ~0");
  });

  await check("JEV_DECISION=shadow -> shadow, không áp dụng", async () => {
    const r = await askProRoute(state(), { JEV_DECISION: "shadow" });
    assert.equal(r.mode, "shadow");
    assert.equal(r.used_jev_answer, false);
  });

  await check("không có key -> no_key, dùng đường cũ", async () => {
    const r = await askProRoute(state(), { JEV_API_KEY: "", TYPESAFE_API_KEY: "" });
    assert.equal(r.mode, "no_key");
    assert.equal(r.reason, "missing_key");
    assert.equal(r.route, "retry_same_model");
  });

  await check("key placeholder 'dummy-...' -> no_key, KHÔNG gọi mạng", async () => {
    const r = await askProRoute(state(), { JEV_API_KEY: "dummy-abcdef123456" });
    assert.equal(r.mode, "no_key");
    assert.equal(r.reason, "placeholder_key");
  });

  await check("key thật nhưng sai -> error, KHÔNG throw, dùng đường cũ", async () => {
    const r = await askProRoute(state(), { JEV_API_KEY: "apikey_definitely_not_real_zzz" });
    assert.ok(r.mode === "error" || r.mode === "no_key", `mode=${r.mode}`);
    assert.equal(r.used_jev_answer, false);
    assert.equal(r.route, "retry_same_model", "Jev lỗi không được làm hỏng app");
  });
}

// ---------------------------------------------------------------------------
// B. OFFLINE — contract + guard dữ liệu cấm
// ---------------------------------------------------------------------------

async function offlineTests() {
  console.log("\n== B. Contract & dữ liệu cấm (offline) ==");

  await check("Choice có đúng 3 phương án, khả dụng ngay trong code", () => {
    assert.deepEqual(Object.keys(PRO_ROUTE_OPTIONS).sort(), [
      "deterministic_fallback",
      "retry_same_model",
      "switch_model",
    ]);
    for (const [k, v] of Object.entries(PRO_ROUTE_OPTIONS)) {
      assert.ok(v.length > 20, `mô tả ${k} phải đủ cụ thể để model chọn đúng`);
    }
  });

  await check("ngưỡng confidence nằm trong (0,1)", () => {
    assert.ok(PRO_ROUTE_MIN_CONFIDENCE > 0 && PRO_ROUTE_MIN_CONFIDENCE < 1);
  });

  await check("state chứa field cấm -> chặn, KHÔNG gửi đi", async () => {
    const leak = { ...state(), phone: "0909123456" } as unknown as ProFailureState;
    assert.deepEqual(forbiddenKeysIn(leak), ["phone"]);
    const r = await askProRoute(leak, { JEV_API_KEY: "apikey_not_used_because_blocked" });
    assert.equal(r.mode, "forbidden_state");
    assert.equal(r.used_jev_answer, false);
  });

  await check("mọi field cấm đều bị chặn", () => {
    for (const key of ["original_text", "listing_text", "listingText", "phone", "contact_name", "contactName", "email", "api_key", "apiKey", "auth"]) {
      assert.deepEqual(forbiddenKeysIn({ [key]: "x" }), [key], `thiếu guard cho ${key}`);
    }
  });

  await check("state sạch -> không bị chặn", () => {
    assert.deepEqual(forbiddenKeysIn(state()), []);
  });

  await check("confidence thấp -> bỏ qua Jev, dùng đường cũ", () => {
    const r = rankProRoute(
      { choice: "deterministic_fallback", confidence: 0.2 },
      { defaultRoute: "retry_same_model" },
    );
    assert.equal(r.usedJevAnswer, false);
    assert.equal(r.route, "retry_same_model", "Jev rất bất định -> không được tin");
    assert.equal(r.reason, "low_confidence");
  });

  await check("confidence cao -> dùng ý Jev", () => {
    const r = rankProRoute({ choice: "switch_model", confidence: 0.92 }, { defaultRoute: "retry_same_model" });
    assert.equal(r.usedJevAnswer, true);
    assert.equal(r.route, "switch_model");
  });

  await check("Jev trả phương án ngoài danh sách -> bỏ qua", () => {
    const r = rankProRoute(
      { choice: "delete_database" as never, confidence: 0.99 },
      { defaultRoute: "retry_same_model" },
    );
    assert.equal(r.usedJevAnswer, false);
    assert.equal(r.route, "retry_same_model");
    assert.equal(r.reason, "unknown_option");
  });

  await check("Jev không trả lời -> đường cũ", () => {
    const r = rankProRoute(null, { defaultRoute: "switch_model" });
    assert.equal(r.route, "switch_model");
    assert.equal(r.usedJevAnswer, false);
  });

  await check("receipt KHÔNG chứa key dù đã gọi thật/lỗi", () => {
    const line = formatJevDecisionReceipt({
      contract: "pro-analysis-route",
      mode: "error",
      route: "retry_same_model",
      confidence: null,
      probabilities: null,
      model: null,
      latency_ms: 5,
      input_tokens: null,
      output_tokens: null,
      used_jev_answer: false,
      reason: "call_failed status=401 name=AuthenticationError",
      at: "2026-01-01T00:00:00.000Z",
    });
    assert.ok(!line.includes("apikey"));
    assert.ok(!line.includes("sk-"));
    for (const k of ["contract=", "mode=", "route=", "used_jev=", "confidence=", "latency_ms="]) {
      assert.ok(line.includes(k), `thiếu ${k}`);
    }
  });

  await check("env helpers: on/off/shadow", () => {
    assert.equal(jevDecisionEnabled({}), true);
    assert.equal(jevDecisionEnabled({ JEV_DECISION: "off" }), false);
    assert.equal(jevDecisionEnabled({ JEV_DECISION: "0" }), false);
    assert.equal(jevDecisionEnabled({ JEV_DECISION: "false" }), false);
    assert.equal(jevDecisionShadow({ JEV_DECISION: "shadow" }), true);
    assert.equal(jevDecisionShadow({}), false);
  });
}

// ---------------------------------------------------------------------------
// C. HÀNH VI THẬT — 3 CA: rõ ràng / mơ hồ / phải escalate
// ---------------------------------------------------------------------------

async function behaviourTests() {
  console.log("\n== C. 3 ca hành vi trong vòng loop thật (OpenRouter stub) ==");

  function stubFetch(responder: (model: string, n: number) => { status: number; payload: unknown }) {
    const captured: { model: string; body: Record<string, unknown> }[] = [];
    const n0 = new Map<string, number>();
    globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const model = String(body.model);
      const n = (n0.get(model) ?? 0) + 1;
      n0.set(model, n);
      captured.push({ model, body });
      const r = responder(model, n);
      return r.status === 200 ? sseResponse(r.payload, model) : jsonResponse(r.status, r.payload);
    }) as typeof fetch;
    return () => captured;
  }

  const ok = (model: string) => ({
    status: 200,
    payload: { model, choices: [{ message: { content: JSON.stringify(cleanAnalysis()) } }] },
  });
  const hallucinated = (model: string) => ({
    status: 200,
    payload: {
      model,
      choices: [
        {
          message: {
            content: JSON.stringify({
              ...cleanAnalysis(),
              warnings: [
                { severity: "high", title: "Pháp lý", explanation: "Pháp lý đã được xác minh.", requires_verification: false, evidence_source: "listing" },
              ],
            }),
          },
        },
      ],
    },
  });
  const rateLimited = () => ({ status: 429, payload: { error: { message: "Rate limit exceeded" } } });

  const CHAIN_ENV = {
    OPENROUTER_API_KEY: "test-key",
    PRO_ANALYSIS_MODEL: QWEN,
    PRO_ANALYSIS_FALLBACK_MODELS: GEMMA,
    // Tắt Jev: đo hành vi NỀN (đường cũ) làm chuẩn so sánh.
    JEV_DECISION: "off",
  };

  await withEnv(CHAIN_ENV, async () => {
    // CA 1 — RÕ RÀNG: Qwen trả lời ngay, 1 request, không cần quyết định.
    await check("CA1 rõ ràng: Qwen OK -> 1 request, 0 quyết định Jev", async () => {
      const captured = stubFetch((m) => ok(m));
      const out = await generateProAnalysis(sampleEvidence());
      assert.equal(out.fromFallback, false);
      assert.equal(out.model, QWEN);
      assert.equal(captured().length, 1, "không được gọi thừa");
    });

    // CA 2 — MƠ HỒ: model hỏng JSON (lỗi không lặp lại) -> vẫn retry model này.
    await check("CA2 mơ hồ: JSON hỏng lần 1 -> retry cùng model, lần 2 thành công", async () => {
      const captured = stubFetch((m, n) =>
        n === 1 ? { status: 200, payload: { model: m, choices: [{ message: { content: "{khong phai json" } }] } } : ok(m),
      );
      const out = await generateProAnalysis(sampleEvidence());
      assert.equal(out.fromFallback, false);
      assert.equal(out.metrics.validation_failed, true);
      const perModel = captured().filter((c) => c.model === QWEN).length;
      assert.equal(perModel, 2, "lỗi chưa lặp lại thì retry model này là hợp lý");
    });

    // CA 3 — PHẢI ESCALATE: guard reject (ảo giác) lặp lại 2 model -> deterministic.
    await check("CA3 escalate: cả 2 model bịa -> deterministic fallback, KHÔNG lưu", async () => {
      stubFetch((m) => hallucinated(m));
      const out = await generateProAnalysis(sampleEvidence());
      assert.equal(out.fromFallback, true);
      assert.equal(out.model, null, "không được gán model khi rơi fallback");
      assert.equal(out.metrics.guard_failed, true);
      assert.ok(out.analysis.summary.headline.length > 0, "vẫn phải có nội dung cho UI");
      assert.equal(out.fallbackReason, "all_models_failed");
    });
  });

  // 429 không retry: mỗi model 1 request, tối đa 2 khi cả chain đều 429.
  await withEnv({ ...CHAIN_ENV, JEV_DECISION: "off" }, async () => {
    await check("nền (Jev tắt): mọi model 429 -> mỗi model đúng 1 request", async () => {
      const captured = stubFetch(() => rateLimited());
      const out = await generateProAnalysis(sampleEvidence());
      assert.equal(out.fromFallback, true);
      // 429 không retry (2026-09-30): 1 request / model. Con số dưới đây chỉ
      // là chuẩn so sánh để test dưới chứng minh Jev bật không đổi hành vi.
      assert.equal(captured().length, 2, "giữ nguyên hành vi nền để so sánh được");
    });
  });

  // Khi Jev BẬT và key thật: vẫn phải cho ra report hợp lệ (dù key hỏng/lỗi).
  await withEnv({ ...CHAIN_ENV, JEV_DECISION: "on", JEV_API_KEY: "" }, async () => {
    await check("Jev bật nhưng không có key -> vẫn ra report, hành vi y hệt nền", async () => {
      const captured = stubFetch(() => rateLimited());
      const out = await generateProAnalysis(sampleEvidence());
      assert.equal(out.fromFallback, true);
      assert.ok(out.analysis.summary.headline.length > 0);
      assert.equal(captured().length, 2, "không có key -> phải y hệt đường cũ");
    });
  });
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

// ---------------------------------------------------------------------------
// D. LIVE — chỉ chạy khi có key thật. KHÔNG chạy trong npm test.
// ---------------------------------------------------------------------------

async function liveTests() {
  const key = (process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY || "").trim();
  const isPlaceholder = !key || key.toLowerCase().startsWith("dummy");
  console.log(
    `\n== D. LIVE (bỏ qua: ${isPlaceholder ? "chưa có TYPESAFE_API_KEY thật" : "có key"}) ==`,
  );
  if (isPlaceholder) {
    console.log("  --  đặt TYPESAFE_API_KEY thật rồi chạy: node --experimental-strip-types --import ./tests/register-loader.mjs tests/jev-decision-live.ts");
    return;
  }

  await check("LIVE: gọi Jev thật, trả về phương án hợp lệ", async () => {
    const r = await askProRoute(state({ attempt: 2, modelsRemaining: 1 }), process.env);
    assert.equal(r.mode, "live", `mode=${r.mode} reason=${r.reason}`);
    assert.equal(r.used_jev_answer, true);
    assert.ok(Object.keys(PRO_ROUTE_OPTIONS).includes(r.route));
    assert.ok((r.confidence ?? 0) >= PRO_ROUTE_MIN_CONFIDENCE);
    assert.ok(r.latency_ms > 0);
    assert.ok(r.model, "phải có tên model Jev trả lời");
    assert.ok(r.probabilities, "phải có phân bố xác suất để audit");
    console.log(`      -> ${formatJevDecisionReceipt(r)}`);
  });
}

async function main() {
  console.log("\n== 0. Contract hợp lệ ==");
  await check("SDK có thể import và tạo client", async () => {
    const m = await import("@typesafe-ai/sdk");
    assert.equal(typeof m.TypeSafeClient, "function");
    assert.equal(typeof m.choice, "function");
  });
  await check("chain v1 vẫn là Qwen -> Gemma (không đổi)", () => {
    const chain = resolveModelChain({});
    assert.deepEqual(chain, [QWEN, GEMMA]);
  });

  await compatibilityTests();
  await offlineTests();
  await behaviourTests();
  await liveTests();

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
