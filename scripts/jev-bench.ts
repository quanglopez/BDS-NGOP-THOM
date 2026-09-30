#!/usr/bin/env node
// Đo vòng lặp: đường CŨ (không Jev) vs đường JEV.
//
// Chạy: npm run jev:bench
// Nếu TYPESAFE_API_KEY that -> dùng Jev thật. Nếu không -> dùng bộ mô phỏng
// quyết định và GHI RÕ là mô phỏng, KHÔNG được coi là số liệu thật.
//
// Đo trên 6 kịch bản lấy từ đúng các chế độ lỗi đang xảy ra trong repo
// (429, JSON cụt, guard chặn ảo giác, JSON hỏng, param không hỗ trợ, hỏng hết).
//
// Số đo mỗi kịch bản:
//   generations - số lần gọi OpenRouter (mỗi lần = cả Evidence Pack + 3000 token)
//   input/output tokens - theo usage provider trả về
//   retries      - số lần thử lại
//   human        - số lần phải dừng lại vì AI hỏng (deterministic fallback)

import { askProRoute, type ProFailureState } from "../lib/ai/jev-decision";
import { generateProAnalysis } from "../lib/ai/pro-analysis";
import { buildEvidencePack } from "../lib/ai/evidence";
import { analyzeListing } from "../lib/scoring";
import type { ProAnalysis } from "../lib/ai/schema";

const QWEN = "qwen/qwen3.8-27b:free";
const GEMMA = "google/gemma-4-31b-it:free";

const LISTING =
  "Bán gấp! Nhà mặt tiền Thủy Vân 80m2, 4 tầng, ngân hàng thanh lý, giá 5.5 tỷ, sổ hồng riêng, hầm xe hơi";

function evidence() {
  return buildEvidencePack({
    title: LISTING.slice(0, 100),
    price: 5500000000,
    area: 80,
    bedrooms: 4,
    ward: null,
    region: "Vũng Tàu",
    listingUrl: "https://www.nhatot.com/tin/1.htm",
    listingText: LISTING,
    result: analyzeListing(LISTING),
    dealType: "ngop_ngon",
    scoringVersion: "jev-v1",
    analysisVersion: "pro-v1",
  });
}

function good(): ProAnalysis {
  return {
    summary: { headline: "Tin 72/100 điểm", text: "Dữ liệu hiện tại cho thấy tiềm năng.", confidence: "medium" },
    highlights: [{ type: "positive", title: "Giá hợp lý", explanation: "Theo giá chào bán.", evidence_source: "scoring" }],
    score_explanation: {
      summary: "Điểm yếu tố không cộng trực tiếp thành điểm tổng.",
      strengths: [{ title: "Vị trí", explanation: "Mặt tiền.", evidence_source: "listing" }],
      weaknesses: [],
    },
    factor_analysis: [{ factor: "Giá", score: 72, label: "Tốt", explanation: "Theo giá.", evidence_source: "calculated" }],
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

function lying(): ProAnalysis {
  return {
    ...good(),
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
}

// --- 6 kịch bản lỗi thật -----------------------------------------------

type Scenario = {
  id: string;
  desc: string;
  respond: (model: string, n: number) => { status: number; payload: unknown };
};

const okPayload = (model: string) => ({
  status: 200,
  payload: {
    model,
    choices: [{ message: { content: JSON.stringify(good()) } }],
    // Usage gia lap de so sanh token giua hai duong. Gia tri nao khong quan
    // trong — chi duong danh nao tieu it hon moi la thay doi dang do.
    usage: { prompt_tokens: 1200, completion_tokens: 900 },
  },
});

// Một lần gọi bị TỪ CHỐI sau khi đã sinh ra nội dung vẫn tốn input+output
// token thật (đó chính là cái Jev giúp bỏ). Nên stub phải trả usage cho
// các payload 200 này, nếu không sẽ đo sai (thấy 0 token tiết kiệm).
const USAGE = { prompt_tokens: 1200, completion_tokens: 900 };

const badJsonPayload = (model: string) => ({
  status: 200,
  payload: { model, choices: [{ message: { content: "{hong" } }], usage: USAGE },
});

const liePayload = (model: string) => ({
  status: 200,
  payload: { model, choices: [{ message: { content: JSON.stringify(lying()) } }], usage: USAGE },
});

const SCENARIOS: Scenario[] = [
  {
    id: "S1",
    desc: "429 trên cả 2 model (mô hình nền: 4 lần gọi)",
    respond: () => ({ status: 429, payload: { error: { message: "Rate limit exceeded" } } }),
  },
  {
    id: "S2",
    desc: "Qwen JSON hỏng -> Ling OK (lỗi KHÔNG lặp lại)",
    respond: (m, n) => (n === 1 ? badJsonPayload(m) : okPayload(m)),
  },
  {
    id: "S3",
    desc: "Qwen ảo giác bị guard chặn -> Ling OK",
    respond: (m, n) => (n === 1 ? liePayload(m) : okPayload(m)),
  },
  {
    id: "S4",
    desc: "CẢ 2 model đều ảo giác (4 lần gọi để rồi vẫn hỏng)",
    respond: (m) => liePayload(m),
  },
  {
    id: "S5",
    desc: "CẢ 2 model JSON hỏng (4 lần gọi, không bao giờ hợp lệ)",
    respond: (m) => badJsonPayload(m),
  },
  {
    id: "S6",
    desc: "Qwen bị cắt JSON (finish_reason=length)",
    respond: (m) => ({
      status: 200,
      payload: { model: m, choices: [{ finish_reason: "length", message: { content: '{"summary":{"head' } }], usage: USAGE },
    }),
  },
];

// --- Bộ mô phỏng quyết định (khi KHÔNG có key thật) ----------------------
// KHÔNG phải Jev. Chỉ để đo được "nếu quyết định đúng, tiết kiệm bao nhiêê".
// Kết quả in ra sẽ ghi rõ là MÔ PHỎNG.
//
// Cách làm: chặn ở TẦNG HTTP, trả về đúng shape System One. Như vậy SDK thật
// vẫn parse, `rankProRoute` vẫn chạy, confidence vẫn được áp dụng — không
// patch module, không bypass logic nào.

function simulatedDecision(state: ProFailureState): "retry_same_model" | "switch_model" | "deterministic_fallback" {
  // Mô phỏng một model biết đọc lịch sử lỗi: lỗi lặp lại -> đổi model ngay.
  if (state.priorFailures.includes(state.failure) && state.attempt >= 1) {
    return state.modelsRemaining > 0 ? "switch_model" : "deterministic_fallback";
  }
  if (state.attempt < 2) return "retry_same_model";
  return state.modelsRemaining > 0 ? "switch_model" : "deterministic_fallback";
}

/** Trả về response System One hợp lệ cho state của pro-analysis. */
function jevSystemOneBody(state: ProFailureState): unknown {
  const route = simulatedDecision(state);
  const probs: Record<string, number> = { retry_same_model: 0.03, switch_model: 0.9, deterministic_fallback: 0.07 };
  // Dồn toàn bộ xác suất vào phương án được chọn để confidence khớp 0.93.
  for (const k of Object.keys(probs)) probs[k] = k === route ? 0.93 : 0.035;
  return {
    model: "jev-latest",
    answers: {
      next_step: {
        type: "choice",
        choice: route,
        confidence: 0.93,
        probabilities: probs,
        legend: undefined,
      },
    },
    usage: { input_tokens: 180, output_tokens: 12 },
  };
}

// --- Đo ----------------------------------------------------------------

type Row = {
  id: string;
  desc: string;
  gen_old: number;
  gen_jev: number;
  tok_old: number;
  tok_jev: number;
  human_old: number;
  human_jev: number;
  saved: number;
  jev_calls: number;
};

function stubFetch(scn: Scenario, injectJev: boolean) {
  const n0 = new Map<string, number>();
  let calls = 0;
  let jevCalls = 0;
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    const href = typeof url === "string" ? url : String((url as { toString(): string })?.toString() ?? url);

    // Đường gọi Jev (SDK dùng global fetch) -> trả câu trả lời mô phỏng.
    if (injectJev && href.includes("typesafe.ai")) {
      jevCalls += 1;
      const body = JSON.parse(String(init.body ?? "{}")) as { state?: ProFailureState };
      return new Response(JSON.stringify(jevSystemOneBody(body.state as ProFailureState)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const model = String(body.model);
    const n = (n0.get(model) ?? 0) + 1;
    n0.set(model, n);
    calls += 1;
    const r = scn.respond(model, n);
    return new Response(typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { openRouter: () => calls, jev: () => jevCalls };
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

function isLiveKey(): boolean {
  const k = (process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY || "").trim();
  return !!k && !k.toLowerCase().startsWith("dummy");
}

async function main() {
  const live = isLiveKey();
  const rows: Row[] = [];

  for (const scn of SCENARIOS) {
    const baseEnv: Record<string, string | undefined> = {
      OPENROUTER_API_KEY: "bench",
      PRO_ANALYSIS_MODEL: QWEN,
      PRO_ANALYSIS_FALLBACK_MODELS: GEMMA,
      // Nếu không có key thật thì đặt 1 key giả để code đi vào nhánh live,
      // rồi chặn ở tầng fetch bên dưới.
      JEV_API_KEY: live ? process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY : "apikey_bench_simulated",
    };

    // Đường CŨ
    const cOld = stubFetch(scn, false);
    const outOld = await withEnv({ ...baseEnv, JEV_DECISION: "off" }, () => generateProAnalysis(evidence()));
    const genOld = cOld.openRouter();

    // Đường Jev
    const cJev = stubFetch(scn, !live);
    const outJev = await withEnv({ ...baseEnv, JEV_DECISION: "on" }, () => generateProAnalysis(evidence()));
    const genJev = cJev.openRouter();

    rows.push({
      id: scn.id,
      desc: scn.desc,
      gen_old: genOld,
      gen_jev: genJev,
      tok_old: (outOld.metrics.input_tokens ?? 0) + (outOld.metrics.output_tokens ?? 0),
      tok_jev: (outJev.metrics.input_tokens ?? 0) + (outJev.metrics.output_tokens ?? 0),
      human_old: outOld.fromFallback ? 1 : 0,
      human_jev: outJev.fromFallback ? 1 : 0,
      saved: genOld - genJev,
      jev_calls: cJev.jev(),
    });
  }

  // --- Báo cáo ---
  const w = 10;
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const padL = (s: string | number, n: number) => String(s).padStart(n);
  console.log(`\n${"=".repeat(78)}`);
  console.log(`  SO DO: DUONG CU (khong Jev)  vs  DUONG JEV`);
  console.log(`  Nguon quyet dinh Jev: ${live ? "JEV THAT (TYPESAFE_API_KEY)" : "MO PHONG (chua co key that)"}`);
  console.log(`${"=".repeat(78)}\n`);
  console.log(
    pad("ID", 4) + pad("KICH BAN", 44) + padL("gen CU", 8) + padL("gen JEV", 10) + padL("TIET KIEM", 11),
  );
  console.log("-".repeat(78));
  for (const r of rows) {
    console.log(
      pad(r.id, 4) + pad(r.desc.slice(0, 42), 44) + padL(r.gen_old, 8) + padL(r.gen_jev, 10) + padL(r.saved, 11),
    );
  }
  console.log("-".repeat(78));
  const sum = (k: keyof Row) => rows.reduce((a, r) => a + (r[k] as number), 0);
  const gOld = sum("gen_old");
  const gJev = sum("gen_jev");
  const tOld = sum("tok_old");
  const tJev = sum("tok_jev");
  console.log(
    pad("TONG", 4) + pad("", 44) + padL(gOld, 8) + padL(gJev, 10) + padL(gOld - gJev, 11),
  );
  console.log("");
  console.log(`  Token output (stub): CU=${tOld}  JEV=${tJev}`);
  console.log(`  Generations giam:    ${gOld} -> ${gJev}  (${gOld > 0 ? Math.round((1 - gJev / gOld) * 100) : 0}%)`);
  console.log(`  So lan goi Jev:      ${sum("jev_calls")}`);
  console.log(`  Report hỏng (human can xac nhan): CU=${sum("human_old")}  JEV=${sum("human_jev")}`);

  // --- Weekly decision receipt ---
  console.log(`\n${"-".repeat(78)}`);
  console.log("  WEEKLY DECISION RECEIPT");
  console.log(`${"-".repeat(78)}`);
  console.log(`  decisions made        : ${rows.filter((r) => r.saved > 0).length} / ${rows.length} kich ban`);
  console.log(`  confidence            : 0.93 (simulated) hoac thuc te neu co key`);
  console.log(`  escalations           : ${sum("human_jev")} (deterministic fallback)`);
  console.log(`  false positives       : ${rows.filter((r) => r.human_jev > r.human_old).length} (Jev lam hong them report)`);
  console.log(`  money saved           : ${gOld - gJev} generations x ~3.2k output token`);
  console.log(`  next contract to tune : guard_failed -> switch_model (kiem chung nguong 0.5)`);
  if (!live) {
    console.log("");
    console.log("  !! SO LIEU TREN LA MO PHONG. KHONG PHAI SO LIEU THAT.");
    console.log("  !! Dat TYPESAFE_API_KEY that roi chay lai: npm run jev:bench");
  }
  console.log("");
}

main().catch((e) => {
  console.error(`jev-bench loi: ${(e as Error).message}`);
  process.exit(1);
});
