// Composition root cho Cloudflare scheduled handler (Stage 2 PR-1).
//
// Nối binding của Worker vào đúng deps mà 2 cron lib đã nhận, để scheduled
// handler tái dùng CHÍNH logic của HTTP route — không copy, không viết lại guard.
// Không tự fetch route của mình: mọi thứ gọi trực tiếp bằng hàm.
import { adminClient } from "@/lib/admin";
import { createSupabaseEnrichmentStore } from "@/lib/radar/enrichment-store";
import { createJevEnrichmentProvider } from "@/lib/radar/enrichment-provider";
import { runEnrichmentWorker } from "@/lib/radar/enrichment-worker";
import { runEnrichmentJob, type EnrichmentCronDeps } from "@/lib/radar/enrichment-cron";
import { listActiveRadars, scanRadar, markRadarScanFailed } from "@/lib/radar/data";
import { runRadarScanJob, type RadarScanCronDeps } from "@/lib/radar/scan-cron";
import type { ScheduledRunners } from "@/lib/radar/cron-dispatch";

/** Deps enrichment y như route /api/cron/radar-enrichment dùng. */
export function enrichmentCronDeps(env: Record<string, string | undefined>): EnrichmentCronDeps {
  return {
    env,
    createStore: () => createSupabaseEnrichmentStore(adminClient()),
    createProvider: (key) => createJevEnrichmentProvider({ key }),
    runWorker: runEnrichmentWorker,
  };
}

/** Deps scan y như route /api/cron/radar-scan dùng. */
export function radarScanCronDeps(env: Record<string, string | undefined>): RadarScanCronDeps {
  return {
    env,
    createDb: () => adminClient(),
    listActiveRadars: (db, limit) => listActiveRadars(db, limit),
    scanRadar: (db, radar) => scanRadar(db, radar),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    markScanFailed: (db, radarId) => markRadarScanFailed(db, radarId),
  };
}

/** Runner cho dispatcher scheduled. Không nhận request, không cần CRON_SECRET. */
export function createScheduledRunners(env: Record<string, string | undefined>): ScheduledRunners {
  return {
    enrichment: () => runEnrichmentJob(enrichmentCronDeps(env)),
    scan: () => runRadarScanJob(radarScanCronDeps(env)),
  };
}
