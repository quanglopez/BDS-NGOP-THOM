import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { adminClient } from "@/lib/admin";
import { listActiveRadars, scanRadar } from "@/lib/radar/data";

// Quét định kỳ toàn bộ Radar đang chạy (Vercel Cron, gọi 1 lần/ngày lúc 03:07).
//
// Xác thực: Vercel Cron gửi `Authorization: Bearer <CRON_SECRET>`. Thiếu secret thì
// trả 500 và KHÔNG quét gì — không bao giờ để route chạy không kiểm soát.
export const runtime = "nodejs";
export const maxDuration = 300;

/** Số Radar xử lý tối đa mỗi lần chạy. */
const MAX_RADARS_PER_RUN = 50;
/** Radar đã quét trong khoảng thời gian này thì bỏ qua lần này (chống quét lặp khi cron chạy lại). */
const MIN_MINUTES_BETWEEN_SCANS = 30;
/** Nghỉ giữa các Radar để không dồn request vào Supabase trong một nhịp. */
const STAGGER_MS = 250;
const MINUTE_MS = 60_000;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Cron không được xác thực." },
    { status: 401 },
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron:radar-scan] CRON_SECRET chưa được cấu hình");
    return NextResponse.json(
      { error: "Cron chưa được cấu hình." },
      { status: 500 },
    );
  }

  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^bearer\s+/i, "").trim();
  if (!safeEqual(token, secret)) return unauthorized();

  const db = adminClient();
  const radars = await listActiveRadars(db, MAX_RADARS_PER_RUN);
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
    const lastCheckedAt = radar.coverage.checkedAt
      ? new Date(radar.coverage.checkedAt).getTime()
      : null;
    if (
      lastCheckedAt != null &&
      !Number.isNaN(lastCheckedAt) &&
      now - lastCheckedAt < MIN_MINUTES_BETWEEN_SCANS * MINUTE_MS
    ) {
      result.skipped++;
      continue;
    }

    try {
      const scan = await scanRadar(db, radar);
      result.scanned++;
      result.newMatches += scan.newMatchCount;
    } catch (e) {
      // Một Radar lỗi không được làm hỏng cả lượt chạy.
      result.failed++;
      result.errors.push({
        id: radar.id,
        name: radar.name,
        reason: e instanceof Error ? e.name : "unknown",
      });
      console.error("[cron:radar-scan]", radar.id, e);
      // Ghi lỗi cũng có thể hỏng — không được để nó làm sập cả lượt chạy.
      // Không bump updated_at: nội dung Radar không đổi, bump chỉ làm xáo trộn
      // danh sách Radar của user (listRadars sort theo updated_at desc).
      try {
        const mark = await db
          .from("radars")
          .update({ last_scan_error: "scan_failed" })
          .eq("id", radar.id);
        if (mark.error)
          console.error("[cron:radar-scan:mark-failed]", radar.id, mark.error.code);
      } catch (markError) {
        console.error("[cron:radar-scan:mark-failed]", radar.id, markError);
      }
    }

    if (index < radars.length - 1) await sleep(STAGGER_MS);
  }

  return NextResponse.json(result);
}