// Dispatch cho Cloudflare scheduled handler — Stage 2 PR-1: CHỈ thêm capability.
//
// Tách khỏi worker entry để test import trực tiếp được, và để entry chỉ còn là
// composition root. Nguyên tắc:
// - scheduled() gọi thẳng logic nội bộ đã tách khỏi route (không Bearer auth).
// - KHÔNG tự fetch HTTP route của chính mình (cùng zone -> lỗi 1042, và tạo
//   vòng lặp Worker). Không có request nào được sinh ra ở đây.
// - Cron lạ -> no-op an toàn, không ném, không chạy job nào.

/** Cron expression → job. Phải khớp CHÍNH XÁC chuỗi khai báo trong wrangler
 *  `triggers.crons` (Cloudflare so khớp từng ký tự, kể cả khoảng trắng). */
export const CRON_RADAR_ENRICHMENT = "*/5 * * * *";
export const CRON_RADAR_SCAN = "7 3 * * *";

export type CronJob = "radar-enrichment" | "radar-scan";

/** null = cron không thuộc job nào đã biết. */
export function jobForCron(cron: string): CronJob | null {
  if (cron === CRON_RADAR_ENRICHMENT) return "radar-enrichment";
  if (cron === CRON_RADAR_SCAN) return "radar-scan";
  return null;
}

/** Bindings của Worker -> Record chỉ chứa giá trị text.
 *  Secret/var là text; binding (ASSETS, IMAGES...) không phải text nên bị loại,
 *  đúng contract `env` mà các cron lib đang nhận. */
export function textEnv(env: Record<string, unknown>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Đồng bộ binding text vào process.env.
 *  Trong fetch path OpenNext tự làm việc này (cloudflare/init.js). Scheduled
 *  handler không đi qua fetch nên tự làm, để code dùng chung (adminClient() đọc
 *  process.env.SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL) thấy secret.
 *  Chỉ ghi giá trị text — không ghi binding. */
export function hydrateProcessEnv(env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") process.env[key] = value;
  }
}

export interface ScheduledRunners {
  /** Gọi logic enrichment nội bộ (đã có guard, không cần CRON_SECRET). */
  enrichment: () => Promise<unknown>;
  /** Gọi logic quét radar nội bộ (đã có guard, không cần CRON_SECRET). */
  scan: () => Promise<unknown>;
}

export interface ScheduledOutcome {
  ok: boolean;
  job: CronJob | null;
  ran: boolean;
  /** HTTP status của Response nội bộ, nếu runner trả Response. */
  status?: number;
  error?: string;
}

/** Chạy đúng 1 job theo `controller.cron`. Chỉ runner khớp mới được gọi. */
export async function runScheduledCron(args: { cron: string; runners: ScheduledRunners }): Promise<ScheduledOutcome> {
  const job = jobForCron(args.cron);
  if (!job) {
    console.warn(`[cron:scheduled] cron không nhận diện được, bỏ qua: ${args.cron}`);
    return { ok: true, job: null, ran: false };
  }

  try {
    const result = job === "radar-enrichment" ? await args.runners.enrichment() : await args.runners.scan();
    const status = result instanceof Response ? result.status : undefined;
    return { ok: status == null || status < 400, job, ran: true, status };
  } catch (e) {
    // Lỗi 1 lượt cron không được làm sập Worker; lượt sau chạy lại.
    console.error(`[cron:scheduled] ${job} lỗi`, e);
    return { ok: false, job, ran: false, error: e instanceof Error ? e.name : "unknown_error" };
  }
}
