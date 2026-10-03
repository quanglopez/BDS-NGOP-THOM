// Cron handler cho Auto-Enrichment, tách khỏi route file để test import được
// trực tiếp (Next chỉ cho phép route export handler + config).
// Xác thực như radar-scan: Bearer CRON_SECRET, timingSafeEqual + length guard.
import { timingSafeEqual } from "node:crypto";
import { runEnrichmentWorker, workerSkipReason, ENRICHMENT_ROUTE_LIMITS } from "./enrichment-worker";
import type { EnrichmentProvider } from "./enrichment-provider";
import type { EnrichmentWorkerStore } from "./enrichment-worker";

export interface EnrichmentCronDeps {
  env: Record<string, string | undefined>;
  createStore: () => EnrichmentWorkerStore;
  createProvider: (key: string) => EnrichmentProvider;
  runWorker: typeof runEnrichmentWorker;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  // Length guard TRƯỚC timingSafeEqual: hàm này ném nếu hai buffer khác độ dài.
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

export async function handleEnrichmentCron(req: Request, deps: EnrichmentCronDeps): Promise<Response> {
  const secret = deps.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron:radar-enrichment] CRON_SECRET chưa được cấu hình");
    return json({ error: "Cron chưa được cấu hình." }, 500);
  }

  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^bearer\s+/i, "").trim();
  if (!safeEqual(token, secret)) return json({ error: "Cron không được xác thực." }, 401);

  const skip = workerSkipReason(deps.env);
  if (skip) return json({ ok: true, skipped: skip });

  const key = deps.env.JEV_API_KEY;
  if (!key) {
    // KHÔNG claim job: thiếu key thì không được tiêu allowance.
    console.error("[cron:radar-enrichment] JEV_API_KEY chưa được cấu hình");
    return json({ error: "JEV_API_KEY chưa được cấu hình." }, 500);
  }

  try {
    const result = await deps.runWorker({ store: deps.createStore(), provider: deps.createProvider(key) });
    console.log(`[cron:radar-enrichment] ${JSON.stringify({ ...result, errors: result.errors.length })}`);
    return json(result as unknown as Json);
  } catch (e) {
    // Lỗi hạ tầng (claim/reclaim) — cron sẽ chạy lại lượt sau; job vẫn nằm DB.
    console.error("[cron:radar-enrichment]", e);
    return json({ error: "Worker lỗi hạ tầng." }, 500);
  }
}

export { ENRICHMENT_ROUTE_LIMITS };