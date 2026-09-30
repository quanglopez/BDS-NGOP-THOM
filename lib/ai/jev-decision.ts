// Jev decision contract — bounded judgment thay cho open-ended model call.
//
// MUC TIEU: trong pro-analysis.ts, khi 1 model fail (guard reject / JSON hong /
// 429 / truncated), code HIEN TAI lap lai dung model do voi prompt manh hon,
// toi da 2 attempt x 3 model = 6 lan goi OpenRouter, moi lan gui lai toan bo
// Evidence Pack + 3000 output token. Day la quyet dinh bounded co dap so rõ:
// "retry / doi model / dung deterministic". Day la vi tri Jev gia tri cao nhat.
//
// NGUYEN TAC (xem docs.typesafe.ai/primitives):
//  - Cau hoi NGAN, mot phan quyet dinh, tra ve Choice co confidence.
//  - Code so huu workflow. Jev CHON duong di, KHONG tao side effect.
//  - Khong confidence -> ve duong danh co dinh cua app (khong duoc xau hon hien tai).
//  - Receipt ghi lai moi quyet dinh de do lai, KHONG ghi PII / key.
//
// TAT CA nong do (question + criteria + threshold) nam trong file nay de
// review duoc o mot cho - dung y khuyen nghi cua TypeSafe skill.

import { TypeSafeClient, choice, type ChoiceResponse, type EntryType } from "@typesafe-ai/sdk";

// ---------------------------------------------------------------------------
// 1. STATE - chi gui thong tin can cho quyet dinh. KHONG gui listing text.
// ---------------------------------------------------------------------------

/** Che do hien hanh cua model trong chain khi quyet dinh duoc hoi. */
export type ProFailureKind =
  | "provider_429" // bi chan rate limit - doi model, thu lai cung do
  | "provider_timeout"
  | "provider_network"
  | "provider_error"
  | "validation_failed" // tra JSON khong parse/validate duoc
  | "guard_failed" // model bia dac -> guard chan
  | "provider_truncated" // finish_reason=length, bi cat giua chung
  | "provider_bad_json"
  | "provider_empty_content"
  | "provider_unsupported_param";

export interface ProFailureState {
  /** Attempt hien tai (1-based) tren model dang xet. */
  attempt: number;
  /** Vi tri model trong chain (0-based). */
  modelIndex: number;
  /** Ten model dang chay. Chi de model doc - KHONG phai du lieu nguoi dung. */
  model: string;
  /** Ly do fail cua attempt nay. */
  failure: ProFailureKind;
  /** Cac model da fail truoc do trong chain, theo thu tu. */
  priorModels: string[];
  /**
   * Cac ly do da gap o model TRUOC DO. Dung de phan biet "loi ngau nhien
   * (thu lai duoc)" voi "loi lap lai (doi model ngay)".
   *
   * SEMANTICS QUAN TRONG: chi gom loi TRUOC attempt hien tai — KHONG gom loi
   * dang xay ra. Caller PHAI hoi truoc khi push loi hien tai vao mang nay.
   * Neu nham thu tu, state se noi "loi nay da lap lai" ngay lan dau, model
   * doi model som, va attempt 2 (vốn de cuu loi ngau nhien) bi bo mat.
   * Sai so nay ton 2/6 kich ban — bat duoc bang `npm run jev:bench`.
   */
  priorFailures: ProFailureKind[];
  /** Ly do guard chan, da cat ngan. Khong chua PII (chi co ma ly do cua app). */
  guardReasons: string[];
  /** Con model nao trong chain sau chua thu? */
  modelsRemaining: number;
}

// ---------------------------------------------------------------------------
// 2. CAU HOI + CRITERIA
// ---------------------------------------------------------------------------

export const PRO_ROUTE_OPTIONS = {
  retry_same_model:
    "Thu lai CHUNG model nay them mot lan. Dung khi loi rat ngau nhien va model chua tung gap loi tuong tu truoc do.",
  switch_model:
    "Bo qua model nay, chuyen sang model tiep theo trong chain. Dung khi model dang gap loi lap lai, hoac loi mang tinh chat rieng cua no.",
  deterministic_fallback:
    "Dung thu model khac, trai ve bao cao deterministic. Dung khi moi model trong chain deu da that bai.",
} as const;

export type ProRouteOption = keyof typeof PRO_ROUTE_OPTIONS;

export const PRO_ROUTE_QUESTION = choice(
  "Mot model sinh bao cao that bai. Hay chon buoc tiep theo de xu ly mot lan thu that bai do. " +
    "Chi chon mot trong ba phuong an duoc mo ta.",
  PRO_ROUTE_OPTIONS,
);

// ---------------------------------------------------------------------------
// 3. NONG DO + ROUTING
// ---------------------------------------------------------------------------

/**
 * Nguong confidence. Duoi nguong -> bo qua Jev, dung duong danh cua app.
 * Gia tri chon de bao dam: Jev KHONG BAO GIO lam ket qua te hon hien tai.
 * `probabilities` la phan bo tren 3 lua chon -> confidence thay doi khi them
 * hoac bot phuong an, nen phai do lai tren du lieu that cua ban.
 */
export const PRO_ROUTE_MIN_CONFIDENCE = 0.5;

/** Cho phep tu tat Jev ma khong can xoa code: JEV_DECISION=off. */
export function jevDecisionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.JEV_DECISION ?? "on").trim().toLowerCase();
  return v !== "off" && v !== "0" && v !== "false";
}

/**
 * Shadow mode: goi Jev de do, NHUNG khong dung ket qua lam dien bien routing.
 * Dung khi can thu cach bo moi truoc khi bat that su.
 * JEV_DECISION=shadow
 */
export function jevDecisionShadow(env: Record<string, string | undefined> = process.env): boolean {
  return (env.JEV_DECISION ?? "").trim().toLowerCase() === "shadow";
}

// ---------------------------------------------------------------------------
// 4. DU LIEU CAM: KHONG BAO GIO gui sang Jev
// ---------------------------------------------------------------------------

/** Ten field cam. Neu state nao chua key nay -> throw, khong gui di. */
export const PRO_ROUTE_FORBIDDEN_KEYS = [
  "original_text",
  "listing_text",
  "listingText",
  "phone",
  "contact_name",
  "contactName",
  "email",
  "api_key",
  "apiKey",
  "auth",
] as const;

/** Kiem tra state khong chua field cam. Tra ve danh sach key bi lo (rong = ok). */
export function forbiddenKeysIn(state: unknown): string[] {
  if (typeof state !== "object" || state === null) return [];
  const keys = Object.keys(state as Record<string, unknown>);
  const banned = new Set<string>(PRO_ROUTE_FORBIDDEN_KEYS);
  return keys.filter((k) => banned.has(k));
}

// ---------------------------------------------------------------------------
// 5. DUONG DANH CO DINH - nganh khi Jev fail / khong du confidence
// ---------------------------------------------------------------------------

/**
 * So attempt toi da cho phep tren MOT model (giong MAX_ATTEMPTS_PER_MODEL).
 * Ke tham so de contract khong phu thuoc vao pro-analysis.ts.
 */
export const PRO_ROUTE_MAX_ATTEMPTS = 2;

/**
 * Quyet dinh mac dinh cua app khi KHONG dung ket qua Jev.
 *
 * RANG BUOC: ham nay phai cho ra DUNG ket qua cua vong loop hien tai, de khi
 * Jev tat / khong co key / call loi, app chay y het nhu truoc. Bat buoc khi
 * rollout khong duoc lam doi hanh vi.
 *
 *   attempt < MAX  -> thu lai model nay (retry instruction)
 *   het attempt, con model sau -> switch_model
 *   het attempt, het chain     -> deterministic_fallback
 */
export function defaultRoute(state: ProFailureState, maxAttempts: number = PRO_ROUTE_MAX_ATTEMPTS): ProRouteOption {
  if (state.attempt < maxAttempts) return "retry_same_model";
  if (state.modelsRemaining > 0) return "switch_model";
  return "deterministic_fallback";
}

// ---------------------------------------------------------------------------
// 6. RECEIPT - moi quyet dinh deu de lai duoc
// ---------------------------------------------------------------------------

export type JevDecisionMode = "live" | "shadow" | "skipped" | "error" | "no_key" | "forbidden_state";

export interface JevDecisionReceipt {
  contract: "pro-analysis-route";
  mode: JevDecisionMode;
  /** Lua chon cuoi cung duoc ap dung. */
  route: ProRouteOption;
  /** Do tin cay cua Jev (0..1). null = khong co). */
  confidence: number | null;
  /** Phan bo xac suat tren tung phuong an. */
  probabilities: Record<string, number> | null;
  /** Model Jev da thuc su tra loi. */
  model: string | null;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  /** False = da dung duong danh co dinh thay vi ket qua Jev. */
  used_jev_answer: boolean;
  /** Ly do khong dung duoc ket qua Jev (ngan, de doc trong log). */
  reason: string;
  at: string;
}

export function formatJevDecisionReceipt(r: JevDecisionReceipt): string {
  return [
    `contract=${r.contract}`,
    `mode=${r.mode}`,
    `route=${r.route}`,
    `used_jev=${r.used_jev_answer}`,
    `confidence=${r.confidence === null ? "-" : r.confidence.toFixed(3)}`,
    `model=${r.model ?? "-"}`,
    `latency_ms=${r.latency_ms}`,
    `input_tokens=${r.input_tokens ?? "-"}`,
    `output_tokens=${r.output_tokens ?? "-"}`,
    `reason=${r.reason}`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// 7. GIOI HANG - giu contract doc lap de test duoc, khong I/O
// ---------------------------------------------------------------------------

export interface RankOptions {
  minConfidence?: number;
  defaultRoute: ProRouteOption;
}

export interface RankResult {
  route: ProRouteOption;
  usedJevAnswer: boolean;
  confidence: number | null;
  reason: string;
}

/**
 * Bien tap quyet dinh cua Jev + do tin cay thanh hanh dung.
 * Pure function -> test duoc khong can mang.
 */
export function rankProRoute(
  answer: Pick<ChoiceResponse<typeof PRO_ROUTE_OPTIONS>, "choice" | "confidence"> | null,
  opts: RankOptions,
): RankResult {
  const min = opts.minConfidence ?? PRO_ROUTE_MIN_CONFIDENCE;
  if (!answer) {
    return { route: opts.defaultRoute, usedJevAnswer: false, confidence: null, reason: "no_answer" };
  }
  const chosen = answer.choice as ProRouteOption;
  if (!(chosen in PRO_ROUTE_OPTIONS)) {
    return { route: opts.defaultRoute, usedJevAnswer: false, confidence: answer.confidence ?? null, reason: "unknown_option" };
  }
  if (!Number.isFinite(answer.confidence) || answer.confidence < min) {
    return {
      route: opts.defaultRoute,
      usedJevAnswer: false,
      confidence: answer.confidence ?? null,
      reason: "low_confidence",
    };
  }
  return { route: chosen, usedJevAnswer: true, confidence: answer.confidence, reason: "ok" };
}

// ---------------------------------------------------------------------------
// 8. GIOI HANG - goi that
// ---------------------------------------------------------------------------

const DECISION_TIMEOUT_MS = 2500;

/**
 * Hoi Jev quyet dinh buoc tiep theo.
 * KHONG BAO GIO throw: moi loi tra ve receipt mode="error" + duong danh co dinh.
 * That bai cua Jev KHONG duoc lam hong report.
 */
export async function askProRoute(
  state: ProFailureState,
  env: Record<string, string | undefined> = process.env,
): Promise<JevDecisionReceipt> {
  const at = new Date().toISOString();
  const fallback = defaultRoute(state);
  const base: Omit<JevDecisionReceipt, "mode" | "route" | "used_jev_answer" | "reason"> = {
    contract: "pro-analysis-route",
    confidence: null,
    probabilities: null,
    model: null,
    latency_ms: 0,
    input_tokens: null,
    output_tokens: null,
    at,
  };

  const reject = (mode: JevDecisionMode, reason: string): JevDecisionReceipt => ({
    ...base,
    mode,
    route: fallback,
    used_jev_answer: false,
    reason,
  });

  if (!jevDecisionEnabled(env)) return reject("skipped", "disabled_by_env");
  if (jevDecisionShadow(env)) return reject("shadow", "shadow_mode");

  const forbidden = forbiddenKeysIn(state);
  if (forbidden.length > 0) return reject("forbidden_state", `forbidden_keys=${forbidden.join("|")}`);

  // Jev_API_KEY la ten da co san trong project (dung oi /api/check).
  // Chap nhan ca TYPESAFE_API_KEY de khop SDK. KHONG log gia tri key.
  const apiKey = env.JEV_API_KEY?.trim() || env.TYPESAFE_API_KEY?.trim() || "";
  if (!apiKey || apiKey.toLowerCase().startsWith("dummy")) {
    return reject("no_key", apiKey ? "placeholder_key" : "missing_key");
  }

  const startedAt = Date.now();
  try {
    const client = new TypeSafeClient({ apiKey, timeout: DECISION_TIMEOUT_MS, logLevel: "off", retry: { maxRetries: 0 } });
    // ProFailureState là record JSON thuần (string | number | boolean | null |
    // array | object) nên khớp EntryType của SDK.
    const res = await client.systemOne({
      state: state as unknown as EntryType,
      questions: { next_step: PRO_ROUTE_QUESTION },
    });
    const answer = res.answers.next_step as ChoiceResponse<typeof PRO_ROUTE_OPTIONS>;
    const ranked = rankProRoute(answer, { defaultRoute: fallback });
    const shadow = jevDecisionShadow(env);
    return {
      ...base,
      mode: "live",
      route: ranked.usedJevAnswer || !shadow ? ranked.route : fallback,
      used_jev_answer: ranked.usedJevAnswer && !shadow,
      confidence: answer.confidence ?? null,
      probabilities: { ...answer.probabilities },
      model: res.model,
      latency_ms: Date.now() - startedAt,
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      reason: ranked.reason,
    };
  } catch (e) {
    const err = e as { status?: number; name?: string };
    return {
      ...base,
      mode: "error",
      route: fallback,
      used_jev_answer: false,
      latency_ms: Date.now() - startedAt,
      reason: `call_failed status=${err.status ?? "-"} name=${err.name ?? "unknown"}`,
    };
  }
}
