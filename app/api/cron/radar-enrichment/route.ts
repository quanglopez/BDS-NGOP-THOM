import { adminClient } from "@/lib/admin";
import { createSupabaseEnrichmentStore } from "@/lib/radar/enrichment-store";
import { createJevEnrichmentProvider } from "@/lib/radar/enrichment-provider";
import { runEnrichmentWorker } from "@/lib/radar/enrichment-worker";
import { handleEnrichmentCron } from "@/lib/radar/enrichment-cron";

// Worker Auto-Enrichment (Vercel Cron). Claim job pending -> dispatch Jev ->
// persist -> terminal. Không bao giờ claim/charge khi thiếu JEV_API_KEY.
// Kill switch / cost guard dừng trước khi claim. Logic + guard nằm ở
// lib/radar/enrichment-cron.ts để test import trực tiếp được.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  return handleEnrichmentCron(req, {
    env: process.env,
    createStore: () => createSupabaseEnrichmentStore(adminClient()),
    createProvider: (key) => createJevEnrichmentProvider({ key }),
    runWorker: runEnrichmentWorker,
  });
}