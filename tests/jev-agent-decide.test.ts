// Test contract Jev cho agent (lib/ai/jev-agent-decide.ts).
// Chay: npm test — offline, khong goi mang that.
//
// Trong file nay phan quan trong nhat la RANH GIỚI CON NGƯỜI:
// Jev KHONG BAO GIỜ mở khóa hành động không đảo ngược.

import { strict as assert } from "node:assert";
import {
  AGENT_ACTIONS,
  AGENT_ASK_HUMAN_MIN_CONFIDENCE,
  AGENT_MIN_CONFIDENCE,
  agentFallbackRoute,
  agentForbiddenKeys,
  askAgentNextAction,
  formatAgentReceipt,
  rankAgentDecision,
  sanitiseAgentState,
  type AgentDecisionState,
} from "../lib/ai/jev-agent-decide.ts";

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

function s(over: Partial<AgentDecisionState> = {}): AgentDecisionState {
  return {
    task: "sua loi test",
    failed_attempts: [],
    candidate_routes: ["huong A", "huong B"],
    reversible: "yes",
    consequential: "no",
    ...over,
  };
}

async function main() {
  console.log("\n== A. Ranh giới con người (quan trọng nhất) ==");

  await check("không đảo ngược -> LUÔN dừng, kể cả khi Jev rất chắc", () => {
    const r = rankAgentDecision(
      { action: "act_now", confidence: 0.99, reversible: "no", consequential: "no" },
      s({ reversible: "no" }),
    );
    assert.equal(r.act, false, "việc không đảo ngược phải dừng");
    assert.equal(r.action, "ask_human");
    assert.equal(r.reason, "human_boundary");
  });

  await check("hệ quả nặng -> LUÔN dừng, kể cả khi Jev rất chắc", () => {
    const r = rankAgentDecision(
      { action: "act_now", confidence: 0.99, reversible: "yes", consequential: "yes" },
      s({ consequential: "yes" }),
    );
    assert.equal(r.act, false);
    assert.equal(r.action, "ask_human");
  });

  await check("việc nhẹ mà Jev xin hỏi người -> hạ xuống, không hỏi linh tinh", () => {
    const r = rankAgentDecision(
      { action: "ask_human", confidence: 0.95, reversible: "yes", consequential: "no" },
      s(),
    );
    assert.equal(r.action, "act_now");
    assert.equal(r.act, true);
    assert.equal(r.reason, "ask_human_downgraded_light_task");
  });

  await check("việc nặng mà Jev bất định về chuyện hỏi -> cũng dừng", () => {
    const r = rankAgentDecision(
      { action: "act_now", confidence: 0.3, reversible: "no", consequential: "yes" },
      s({ reversible: "no", consequential: "yes" }),
    );
    assert.equal(r.act, false, "bất định + nặng = phải hỏi");
  });

  await check("hỏi người cần confidence >= nguong riêng", () => {
    const justUnder = rankAgentDecision(
      { action: "ask_human", confidence: AGENT_ASK_HUMAN_MIN_CONFIDENCE - 0.01, reversible: "no", consequential: "yes" },
      s({ reversible: "no", consequential: "yes" }),
    );
    assert.equal(justUnder.usedJev, false, "Jev chưa đủ chắc để quyết hỏi người");
    const enough = rankAgentDecision(
      { action: "ask_human", confidence: AGENT_ASK_HUMAN_MIN_CONFIDENCE + 0.01, reversible: "no", consequential: "yes" },
      s({ reversible: "no", consequential: "yes" }),
    );
    assert.equal(enough.usedJev, true);
    assert.equal(enough.act, false);
  });

  await check("quét 48 tổ hợp: không tổ hợp nào mở khóa việc nguy hiểm", () => {
    let checked = 0;
    for (const reversible of ["yes", "no"] as const) {
      for (const consequential of ["yes", "no"] as const) {
        for (const action of Object.keys(AGENT_ACTIONS) as (keyof typeof AGENT_ACTIONS)[]) {
          for (const confidence of [0.1, 0.65, 0.95]) {
            const state = s({ reversible, consequential });
            const r = rankAgentDecision({ action, confidence, reversible, consequential }, state);
            const dangerous = reversible === "no" || consequential === "yes";
            if (dangerous) {
              assert.equal(r.act, false, `LEAK: ${action}/${confidence}/${reversible}/${consequential}`);
            }
            assert.ok(r.action in AGENT_ACTIONS, "luôn trả về hành động hợp lệ");
            checked++;
          }
        }
      }
    }
    assert.equal(checked, 48, "4 hành động x 3 mức confidence x 2 reversible x 2 consequential");
  });

  console.log("\n== B. Bất định & lựa chọn lạ ==");

  await check("confidence thấp -> bỏ qua Jev, dùng đường an toàn", () => {
    const r = rankAgentDecision(
      { action: "research_first", confidence: AGENT_MIN_CONFIDENCE - 0.05, reversible: "yes", consequential: "no" },
      s(),
    );
    assert.equal(r.usedJev, false);
    assert.equal(r.reason, "low_confidence");
  });

  await check("Jev trả nhãn ngoài danh sách -> bỏ qua", () => {
    const r = rankAgentDecision(
      { action: "rm -rf", confidence: 0.99, reversible: "yes", consequential: "no" },
      s(),
    );
    assert.equal(r.usedJev, false);
    assert.ok(r.action in AGENT_ACTIONS);
  });

  await check("null answer -> đường fallback, không crash", () => {
    const r = rankAgentDecision(null, s());
    assert.ok(r.action in AGENT_ACTIONS);
  });

  await check("fallback: đã fail rồi -> đổi hướng, không lặp lại", () => {
    const r = agentFallbackRoute(s({ failed_attempts: ["cach cu"] }));
    assert.equal(r.action, "try_alternative");
    assert.equal(r.act, true);
  });

  await check("fallback: chưa thử gì -> làm ngay việc rẻ", () => {
    assert.equal(agentFallbackRoute(s()).action, "act_now");
  });

  await check("fallback: việc nặng -> hỏi người", () => {
    assert.equal(agentFallbackRoute(s({ consequential: "yes" })).action, "ask_human");
    assert.equal(agentFallbackRoute(s({ reversible: "no" })).act, false);
  });

  console.log("\n== C. Dữ liệu cấm ==");

  await check("mọi field cấm bị chặn", () => {
    for (const k of ["api_key", "token", "secret", "password", "authorization", "phone", "email", "diff", "file_contents", "raw_response"]) {
      assert.deepEqual(agentForbiddenKeys({ [k]: "x" }), [k], `thieu guard cho ${k}`);
    }
  });

  await check("sanitise loại bỏ field cấm VÀ cắt chuỗi dài", () => {
    const dirty = { ...s(), api_key: "sk-secret", task: "x".repeat(2000) };
    const clean = sanitiseAgentState(dirty) as Record<string, unknown>;
    assert.equal(clean.api_key, undefined, "key phải bị loai");
    assert.ok((clean.task as string).length <= 600, "chuoi phai duoc cat");
  });

  await check("state chứa field cấm -> forbidden_state, không gọi mạng", async () => {
    const r = await askAgentNextAction({ ...s(), api_key: "sk-leak" } as unknown as AgentDecisionState, {
      mode: "live",
      env: { TYPESAFE_API_KEY: "apikey_should_not_be_used" },
    });
    assert.equal(r.mode, "forbidden_state");
    assert.equal(r.usedJev, false);
  });

  console.log("\n== D. Input & receipt ==");

  await check("thiếu field -> invalid_input, act=false (fail an toàn)", async () => {
    const r = await askAgentNextAction({ task: "x" } as unknown as AgentDecisionState, { mode: "live" });
    assert.equal(r.mode, "invalid_input");
    assert.equal(r.act, false, "input hong thì phai dung, khong duoc hanh dong");
  });

  await check("không có key -> no_key, dùng fallback, không throw", async () => {
    // s() chưa có failed_attempts nên fallback hợp lý là "làm ngay việc rẻ".
    const r = await askAgentNextAction(s(), { mode: "live", env: { TYPESAFE_API_KEY: "" } });
    assert.equal(r.mode, "no_key");
    assert.equal(r.action, "act_now");
    assert.equal(r.usedJev, false);
  });

  await check("không có key + đã fail -> fallback đổi hướng", async () => {
    const r = await askAgentNextAction(s({ failed_attempts: ["cach cu"] }), {
      mode: "live",
      env: { TYPESAFE_API_KEY: "" },
    });
    assert.equal(r.mode, "no_key");
    assert.equal(r.action, "try_alternative");
  });

  await check("key placeholder -> no_key, không gọi mạng", async () => {
    const r = await askAgentNextAction(s(), { mode: "live", env: { TYPESAFE_API_KEY: "dummy-x" } });
    assert.equal(r.mode, "no_key");
    assert.equal(r.reason, "placeholder_key");
  });

  await check("key sai -> error, không throw, vẫn ra hành động dùng được", async () => {
    const r = await askAgentNextAction(s(), { mode: "live", env: { TYPESAFE_API_KEY: "apikey_bogus_zzz" } });
    assert.ok(r.mode === "error" || r.mode === "no_key", `mode=${r.mode}`);
    assert.ok(r.action in AGENT_ACTIONS);
  });

  await check("mode=off -> không gọi gì", async () => {
    const r = await askAgentNextAction(s(), { mode: "off" });
    assert.equal(r.mode, "off");
    assert.equal(r.latency_ms, 0);
  });

  await check("receipt không lộ key", () => {
    const line = formatAgentReceipt({
      contract: "agent-next-action",
      mode: "error",
      action: "act_now",
      act: false,
      usedJev: false,
      confidence: null,
      probabilities: null,
      best_route: null,
      is_repeat: null,
      model: null,
      latency_ms: 3,
      input_tokens: null,
      output_tokens: null,
      reason: "call_failed status=401",
      at: "2026-01-01T00:00:00.000Z",
    });
    assert.ok(!/sk-|apikey|password/i.test(line));
    for (const k of ["contract=", "action=", "act=", "confidence=", "reason="]) {
      assert.ok(line.includes(k), `thieu ${k}`);
    }
  });

  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
