import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { adminClient } from "@/lib/admin";
import { createSupabaseEnrichmentStore } from "@/lib/radar/enrichment-store";
import { createJevEnrichmentProvider } from "@/lib/radar/enrichment-provider";
import { runEnrichmentWorker, workerSkipReason } from "@/lib/radar/enrichment-worker";

// Worker Auto-Enrichment (Vercel Cron). Claim job pending -> dispatch Jev ->
// persist -> terminal. Xác thực như radar-scan: Bearer CRON_SECRET.
//
// Không bao giờ claim/charge khi thiếu JEV_API_KEY (tránh tiêu allowance mà
// không dispatch được). Kill switch / cost guard dừng trước khi claim.
export const runtime = "nodejs";
export const maxDuration = 300;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Cron không được xác thực." }, { status: 401 });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron:radar-enrichment] CRON_SECRET chưa được cấu hình");
    return NextResponse.json({ error: "Cron chưa được cấu hình." }, { status: 500 });
  }

  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^bearer\s+/i, "").trim();
  if (!safeEqual(token, secret)) return unauthorized();

  const skip = workerSkipReason(process.env);
  if (skip) {
    return NextResponse.json({ ok: true, skipped: skip });
  }

  const key = process.env.JEV_API_KEY;
  if (!key) {
    console.error("[cron:radar-enrichment] JEV_API_KEY chưa được cấu hình");
    return NextResponse.json({ error: "JEV_API_KEY chưa được cấu hình." }, { status: 500 });
  }

  try {
    const db = adminClient();
    const store = createSupabaseEnrichmentStore(db);
    const provider = createJevEnrichmentProvider({ key });
    const result = await runEnrichmentWorker({ store, provider });
    console.log(`[cron:radar-enrichment] ${JSON.stringify({ ...result, errors: result.errors.length })}`);
    return NextResponse.json(result);
  } catch (e) {
    // Lỗi hạ tầng (claim/reclaim) — cron sẽ chạy lại lượt sau; job vẫn nằm DB.
    console.error("[cron:radar-enrichment]", e);
    return NextResponse.json({ error: "Worker lỗi hạ tầng." }, { status: 500 });
  }
}
