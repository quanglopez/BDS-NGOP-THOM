import { adminClient } from "@/lib/admin";
import { listActiveRadars, scanRadar, markRadarScanFailed } from "@/lib/radar/data";
import { handleRadarScanCron } from "@/lib/radar/scan-cron";

// Quét định kỳ toàn bộ Radar đang chạy (Vercel Cron, gọi 1 lần/ngày lúc 03:07).
// Logic + guard nằm ở lib/radar/scan-cron.ts để test import trực tiếp được.
// Kill switch / cost guard dừng TRƯỚC mọi work (không list, không scan, không ghi).
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  return handleRadarScanCron(req, {
    env: process.env,
    createDb: () => adminClient(),
    listActiveRadars: (db, limit) => listActiveRadars(db, limit),
    scanRadar: (db, radar) => scanRadar(db, radar),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    markScanFailed: (db, radarId) => markRadarScanFailed(db, radarId),
  });
}
