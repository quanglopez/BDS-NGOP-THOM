// Cron handler cho quét Radar, tách khỏi route file để test import trực tiếp
// (Next chỉ cho phép route export handler + config). Thứ tự bắt buộc:
// auth → kill switch / cost guard → mới tạo DB + listing + scan.
// Guard nằm TRƯỚC mọi work để kill switch thật sự dừng cost.
import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { workerSkipReason } from "./enrichment-worker";
import type { listActiveRadars } from "./data";

type RadarSummary = Awaited<ReturnType<typeof listActiveRadars>>[number];

export interface RadarScanCronDeps {
  env: Record<string, string | undefined>;
  createDb: () => SupabaseClient;
  listActiveRadars: (db: SupabaseClient, limit: number) => Promise<RadarSummary[]>;
  scanRadar: (db: SupabaseClient, radar: RadarSummary) => Promise<{ newMatchCount: number }>;
  sleep: (ms: number) => Promise<void>;
  markScanFailed: (db: SupabaseClient, radarId: string) => Promise<void>;
}

const MAX_RADARS_PER_RUN = 50;
const MIN_MINUTES_BETWEEN_SCANS = 30;
const STAGGER_MS = 250;
const MINUTE_MS = 60_000;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

type Json = { [k: string]: unknown };
function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleRadarScanCron(req: Request, deps: RadarScanCronDeps): Promise<Response> {
  const secret = deps.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron:radar-scan] CRON_SECRET chua duợc cấu hình");
    return json({ error: "Cron chua duợc cấu hình." }, 500);
  }

  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^bearer\s+/i, "").trim();
  if (!safeEqual(token, secret)) return json({ error: "Cron không được xác thực." }, 401);

  const skip = workerSkipReason(deps.env);
  if (skip) return json({ ok: true, skipped: skip });

  const db = deps.createDb();
  const radars = await deps.listActiveRadars(db, MAX_RADARS_PER_RUN);
  const now = Date.now();

  const result = {
    ok: true,
    total: radars.length,
    scanned: 0,
    skipped: 0,
    failed: 0,
    newMatches: 0,
    errors: [] as { id: string; name: string; reason: string }[],
  };

  for (const [index, radar] of radars.entries()) {
    const lastCheckedAt = radar.coverage.checkedAt ? new Date(radar.coverage.checkedAt).getTime() : null;
    if (lastCheckedAt != null && !Number.isNaN(lastCheckedAt) && now - lastCheckedAt < MIN_MINUTES_BETWEEN_SCANS * MINUTE_MS) {
      result.skipped++;
      continue;
    }

    try {
      const scan = await deps.scanRadar(db, radar);
      result.scanned++;
      result.newMatches += scan.newMatchCount;
    } catch (e) {
      result.failed++;
      result.errors.push({ id: radar.id, name: radar.name, reason: e instanceof Error ? e.name : "unknown" });
      console.error("[cron:radar-scan]", radar.id, e);
      try {
        await deps.markScanFailed(db, radar.id);
      } catch (markError) {
        console.error("[cron:radar-scan:mark-failed]", radar.id, markError);
      }
    }

    if (index < radars.length - 1) await deps.sleep(STAGGER_MS);
  }

  return json(result as unknown as Json);
}

