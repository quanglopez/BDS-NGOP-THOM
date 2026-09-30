// Jev contract cho AGENT (không phải cho app).
//
// Mục tiêu: agent đang cân nhắc một quyết định NHỎ, có đáp án rõ, nhưng lại
// đang tốn một lượt suy luận mở (đọc nhiều file, gọi web, thử lại cách cũ).
// Ở đây Jev trả lời bằng MỘT nhãn, và code/agent chỉ việc làm theo.
//
// Khi nào dùng (xem AGENTS.md):
//   - sắp nghiên cứu tốn kém (web, nhiều tool, tài liệu dài)
//   - sắp LẶP LẠI một cách đã thất bại
//   - sắp nạp nhiều tool
//   - sắp chọn giữa 2+ hướng khác hẳn nhau
//   - sắp đề xuất hành động hệ quả nặng
//
// Khi nào KHÔNG dùng:
//   - viết code, refactor, viết test, giải thích -> cần suy luận sâu, Jev không thay
//   - việc đã rõ và rẻ -> chỉ tốn thêm 1 lần gọi
//   - người dùng gõ "bypass jev" -> bỏ qua, không hỏi lại
//
// Tất cả hằng số ở đây để review được ở một chỗ.

import { TypeSafeClient, choice, noul, type ChoiceResponse, type EntryType, type NoulResponse } from "@typesafe-ai/sdk";

// ---------------------------------------------------------------------------
// 1. STATE
// ---------------------------------------------------------------------------

export interface AgentDecisionState {
  /** Việc cần làm, 1-2 câu. KHÔNG dán nguyên file/URL dài. */
  task: string;
  /** Những cách ĐÃ THỬ và đã thất bại. Rỗng nếu chưa thử gì. */
  failed_attempts: string[];
  /** Các hướng còn lại, mô tả ngắn. */
  candidate_routes: string[];
  /** Hành động sắp làm có thể hoàn tác không? "yes" | "no" */
  reversible: "yes" | "no";
  /** Có thay đổi dữ liệu production / tiền / file đã commit không? "yes" | "no" */
  consequential: "yes" | "no";
}

/** Field tuyệt đối không được gửi. */
export const AGENT_FORBIDDEN_KEYS = [
  "api_key",
  "apikey",
  "token",
  "secret",
  "password",
  "authorization",
  "phone",
  "email",
  "diff",
  "file_contents",
  "raw_response",
] as const;

export function agentForbiddenKeys(state: unknown): string[] {
  if (typeof state !== "object" || state === null) return [];
  const banned = new Set<string>(AGENT_FORBIDDEN_KEYS);
  return Object.keys(state as Record<string, unknown>).filter((k) => banned.has(k));
}

/** Bỏ qua key bị cấm + cắt ngắn, để state luôn nhỏ và không rò rỉ. */
export function sanitiseAgentState(state: AgentDecisionState): EntryType {
  const banned = new Set<string>(AGENT_FORBIDDEN_KEYS);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) {
    if (banned.has(k)) continue;
    out[k] = typeof v === "string" ? v.slice(0, 600) : v;
  }
  return out as EntryType;
}

// ---------------------------------------------------------------------------
// 2. CÂU HỎI
// ---------------------------------------------------------------------------

export const AGENT_ACTIONS = {
  act_now:
    "Có một bước nhỏ, rẻ, dễ đảo ngược để làm ngay. Làm nó, đừng suy luận thêm.",
  research_first:
    "Chưa đủ thông tin để hành động đúng. Cần tra cứu/đọc thêm một lượt có chủ đích trước đã.",
  try_alternative:
    "Cách hiện tại đã thất bại và sẽ tiếp tục thất bại. Dừng lặp lại, chuyển sang hướng khác trong candidate_routes.",
  ask_human:
    "Bước tiếp theo hệ quả nặng, khó đảo ngược, hoặc cần người dùng xác nhận. Dừng lại và hỏi.",
} as const;

export type AgentAction = keyof typeof AGENT_ACTIONS;

export const AGENT_ACTION_QUESTION = choice(
  "Dựa trên `task`, các cách đã thất bại trong `failed_attempts`, các hướng còn lại trong `candidate_routes`, " +
    "cùng `reversible` và `consequential`: bước tiếp theo nên là gì? Chọn đúng một nhãn.",
  AGENT_ACTIONS,
);

/** Câu hỏi phụ đi kèm: hướng nào đáng thử nhất. Trả lời cùng request (rẻ). */
export const AGENT_BEST_ROUTE_QUESTION = choice(
  "Trong `candidate_routes`, hướng nào khả dụng và phù hợp nhất với `task`, xét cả việc đã thất bại ở `failed_attempts`?",
  {
    first: "Hướng được liệt kê đầu tiên.",
    second: "Hướng được liệt kê thứ hai.",
    third: "Hướng được liệt kê thứ ba.",
    other: "Hướng khác ngoài ba hướng trên.",
  },
);

/** Speculative: đây có phải việc lặp lại cách đã hỏng không? */
export const AGENT_IS_REPEAT_QUESTION = noul(
  "Bước tiếp theo có phải là LẶP LẠI một cách đã thử và đã thất bại không?",
);

// ---------------------------------------------------------------------------
// 3. NGƯỠNG + ĐƯỜNG DANH
// ---------------------------------------------------------------------------

/** Dưới ngưỡng -> agent tự quyết, Jev chỉ để tham khảo. */
export const AGENT_MIN_CONFIDENCE = 0.6;

/**
 * ask_human là lựa chọn DUY NHẤT được phép bỏ qua khi agent hành động.
 * Nhưng nó CHỈ được chọn khi Jev khá chắc. Nếu Jev bất định về chuyện hỏi
 * người, thì chính điều đó là lý do phải hỏi.
 */
export const AGENT_ASK_HUMAN_MIN_CONFIDENCE = 0.7;

export interface AgentRankInput {
  action: string;
  confidence: number;
  reversible: "yes" | "no";
  consequential: "yes" | "no";
}

export interface AgentRankOutput {
  action: AgentAction;
  /** true = được phép hành động tự động. false = phải dừng lại hỏi người. */
  act: boolean;
  usedJev: boolean;
  reason: string;
}

/**
 * Dùng khi KHÔNG có Jev: chọn hành động rẻ, đảo ngược, an toàn.
 * Không bao giờ hỏi người khi việc rẻ và đảo ngược.
 */
export function agentFallbackRoute(state: AgentDecisionState): AgentRankOutput {
  if (state.consequential === "yes" || state.reversible === "no") {
    return { action: "ask_human", act: false, usedJev: false, reason: "fallback_consequential" };
  }
  if (state.failed_attempts.length > 0) {
    return { action: "try_alternative", act: true, usedJev: false, reason: "fallback_repeat_failure" };
  }
  return { action: "act_now", act: true, usedJev: false, reason: "fallback_cheap_default" };
}

export function rankAgentDecision(answer: AgentRankInput | null, state: AgentDecisionState): AgentRankOutput {
  const fallback = agentFallbackRoute(state);
  if (!answer) return fallback;

  const action = answer.action as AgentAction;
  if (!(action in AGENT_ACTIONS)) {
    return { ...fallback, reason: "unknown_option" };
  }

  // Bất định -> đừng hành động theo Jev, trừ khi việc vốn đã hỏng rồi.
  if (!Number.isFinite(answer.confidence) || answer.confidence < AGENT_MIN_CONFIDENCE) {
    return { ...fallback, usedJev: false, reason: "low_confidence" };
  }

  // Hỏi người: cần confidence cao, VÀ bản thân việc phải đủ nặng.
  if (action === "ask_human") {
    const heavy = state.consequential === "yes" || state.reversible === "no";
    if (!heavy) {
      return { action: "act_now", act: true, usedJev: true, reason: "ask_human_downgraded_light_task" };
    }
    if (answer.confidence < AGENT_ASK_HUMAN_MIN_CONFIDENCE) {
      return { ...fallback, usedJev: false, reason: "ask_human_low_confidence" };
    }
    return { action: "ask_human", act: false, usedJev: true, reason: "ok" };
  }

  // Jev bảo hành động, nhưng nếu việc hệ quả nặng thì vẫn phải hỏi người.
  // Đây là ranh giới con người: Jev KHÔNG bao giờ mở khóa hành động không thể đảo ngược.
  if (state.consequential === "yes" || state.reversible === "no") {
    return { action: "ask_human", act: false, usedJev: true, reason: "human_boundary" };
  }

  return { action, act: true, usedJev: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// 4. GỌI THẬT
// ---------------------------------------------------------------------------

export type AgentDecisionMode = "live" | "shadow" | "off" | "no_key" | "forbidden_state" | "error" | "invalid_input";

export interface AgentDecisionReceipt {
  contract: "agent-next-action";
  mode: AgentDecisionMode;
  action: AgentAction;
  /** false = phải DỪNG và hỏi người dùng. */
  act: boolean;
  usedJev: boolean;
  confidence: number | null;
  probabilities: Record<string, number> | null;
  best_route: string | null;
  is_repeat: number | null;
  model: string | null;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  reason: string;
  at: string;
}

export function formatAgentReceipt(r: AgentDecisionReceipt): string {
  return [
    `contract=${r.contract}`,
    `mode=${r.mode}`,
    `action=${r.action}`,
    `act=${r.act}`,
    `used_jev=${r.usedJev}`,
    `confidence=${r.confidence === null ? "-" : r.confidence.toFixed(3)}`,
    `best_route=${r.best_route ?? "-"}`,
    `is_repeat=${r.is_repeat ?? "-"}`,
    `model=${r.model ?? "-"}`,
    `latency_ms=${r.latency_ms}`,
    `input_tokens=${r.input_tokens ?? "-"}`,
    `output_tokens=${r.output_tokens ?? "-"}`,
    `reason=${r.reason}`,
  ].join(" ");
}

function validate(state: unknown): state is AgentDecisionState {
  if (typeof state !== "object" || state === null) return false;
  const s = state as Record<string, unknown>;
  return (
    typeof s.task === "string" &&
    s.task.trim().length > 0 &&
    Array.isArray(s.failed_attempts) &&
    Array.isArray(s.candidate_routes) &&
    (s.reversible === "yes" || s.reversible === "no") &&
    (s.consequential === "yes" || s.consequential === "no")
  );
}

/**
 * Hỏi Jev bước tiếp theo. Không bao giờ throw.
 *
 * `mode` (mặc định "shadow"): tính quyết định nhưng KHÔNG áp dụng, để agent
 * so sánh với phán đoán của mình. Truyền "live" để áp dụng thật.
 */
export async function askAgentNextAction(
  state: AgentDecisionState,
  opts: { mode?: "live" | "shadow" | "off"; env?: Record<string, string | undefined> } = {},
): Promise<AgentDecisionReceipt> {
  const env = opts.env ?? process.env;
  const mode = opts.mode ?? "shadow";
  const at = new Date().toISOString();
  const ranked = validate(state) ? rankAgentDecision(null, state) : null;
  const safeAction: AgentAction = ranked?.action ?? "ask_human";
  const base: Omit<AgentDecisionReceipt, "mode"> = {
    contract: "agent-next-action",
    action: safeAction,
    act: ranked?.act ?? false,
    usedJev: false,
    confidence: null,
    probabilities: null,
    best_route: null,
    is_repeat: null,
    model: null,
    latency_ms: 0,
    input_tokens: null,
    output_tokens: null,
    reason: ranked?.reason ?? "invalid_input",
    at,
  };

  if (!validate(state)) return { ...base, mode: "invalid_input" };
  if (mode === "off") return { ...base, mode: "off" };
  if (agentForbiddenKeys(state).length > 0) {
    return { ...base, mode: "forbidden_state", reason: `forbidden_keys=${agentForbiddenKeys(state).join("|")}` };
  }

  const apiKey = env.TYPESAFE_API_KEY?.trim() || env.JEV_API_KEY?.trim() || "";
  if (!apiKey || apiKey.toLowerCase().startsWith("dummy")) {
    return { ...base, mode: "no_key", reason: apiKey ? "placeholder_key" : "missing_key" };
  }

  const startedAt = Date.now();
  try {
    const client = new TypeSafeClient({ apiKey, timeout: 4000, logLevel: "off", retry: { maxRetries: 0 } });
    const res = await client.systemOne({
      state: sanitiseAgentState(state),
      questions: {
        next_action: AGENT_ACTION_QUESTION,
        best_route: AGENT_BEST_ROUTE_QUESTION,
        is_repeat: AGENT_IS_REPEAT_QUESTION,
      },
    });
    const a = res.answers.next_action as ChoiceResponse<typeof AGENT_ACTIONS>;
    const n = res.answers.is_repeat as NoulResponse;
    const decision = rankAgentDecision(
      { action: a.choice, confidence: a.confidence, reversible: state.reversible, consequential: state.consequential },
      state,
    );
    // Shadow: vẫn trả về để so sánh, nhưng act=false để agent không tự động theo.
    const applying = mode === "live";
    return {
      ...base,
      mode,
      action: decision.action,
      act: applying ? decision.act : false,
      usedJev: decision.usedJev,
      confidence: a.confidence,
      probabilities: { ...a.probabilities },
      best_route: res.answers.best_route.choice,
      is_repeat: n.noul,
      model: res.model,
      latency_ms: Date.now() - startedAt,
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      reason: decision.reason,
    };
  } catch (e) {
    const err = e as { status?: number; name?: string };
    return {
      ...base,
      mode: "error",
      latency_ms: Date.now() - startedAt,
      reason: `call_failed status=${err.status ?? "-"} name=${err.name ?? "unknown"}`,
    };
  }
}
