// Adapter Supabase cho enrichment worker.
// - Claim + charge + attempts: qua RPC security definer (atomic, không SELECT->UPDATE).
// - Persist kết quả: bảng radar_matches, CHỈ ghi cột enrichment_* — không bao giờ
//   đụng score/deal_type/is_ngop của signal thủ công.

import type { SupabaseClient } from "@supabase/supabase-js";
import { effectivePlan } from "@/lib/quota";
import { AUTO_ENRICHMENT_DAILY_LIMIT } from "./auto-enrollment";
import type { EnrichmentJobRow, EnrichmentWorkerStore, MatchEnrichmentPatch } from "./enrichment-worker";

export function createSupabaseEnrichmentStore(db: SupabaseClient): EnrichmentWorkerStore {
  const nowISO = () => new Date().toISOString();

  return {
    // Quá lease theo now() của DB (RPC 0022), không theo giờ app.
    // Requeue lùi >= 30s. Không xoá dispatch_started_at.
    async reclaimStaleProcessing(leaseMs, maxAttempts) {
      const { data, error } = await db.rpc("reclaim_stale_auto_enrichment_jobs", {
        p_lease_seconds: Math.max(1, Math.ceil(leaseMs / 1000)),
        p_max_attempts: maxAttempts,
        p_backoff_seconds: 30,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { requeued?: number; failed?: number } | null;
      return { requeued: Number(row?.requeued ?? 0), failed: Number(row?.failed ?? 0) };
    },

    async claimPending(limit) {
      const { data, error } = await db.rpc("claim_auto_enrichment_jobs", { p_limit: limit });
      if (error) throw error;
      return (data ?? []) as EnrichmentJobRow[];
    },

    async isPlanPro(userId) {
      const { data, error } = await db
        .from("users")
        .select("plan,plan_expires_at")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return effectivePlan(data?.plan, data?.plan_expires_at) === "pro";
    },

    async beginDispatch(job) {
      const { data, error } = await db.rpc("begin_auto_enrichment_dispatch_at", {
        p_job_id: job.id,
        p_claim_token: job.claim_token,
        p_daily_limit: AUTO_ENRICHMENT_DAILY_LIMIT,
      });
      if (error) throw error;
      return typeof data === "string" && data.length > 0 ? data : null;
    },

    async releaseToPending(job, patch) {
      const { error } = await db
        .from("auto_enrichment_jobs")
        .update({
          status: "pending",
          claim_token: null,
          processing_started_at: null,
          next_attempt_at: patch.nextAttemptAt,
          error_kind: patch.errorKind,
          last_error: patch.lastError,
          updated_at: patch.updatedAt,
        })
        .eq("id", job.id)
        .eq("claim_token", job.claim_token)
        .eq("status", "processing")
        .select("id");
      if (error) throw error;
    },

    async markTerminal(job, status, error) {
      const { data, error: updateError } = await db
        .from("auto_enrichment_jobs")
        .update({
          status,
          claim_token: null,
          processing_started_at: null,
          error_kind: error?.errorKind ?? null,
          last_error: error?.lastError ?? null,
          updated_at: nowISO(),
        })
        .eq("id", job.id)
        .eq("claim_token", job.claim_token)
        .eq("status", "processing")
        .select("id");
      if (updateError) throw updateError;
      return (data?.length ?? 0) > 0;
    },

    /** Ghi trạng thái processing. Ownership của row phân giải theo BỘ BA
 *  (radar_id, external_id, fingerprint) + thứ tự job:
 *  1) `enrichment_job_id = job.id` — chính job này đang sở hữu row (retry).
 *  2) row chưa ai sở hữu (`enrichment_job_id is null`) và chưa có kết quả.
 *  3) TAKEOVER: row do job KHÁC sở hữu nhưng job đó CỨ HƠN job này
 *     (`enrichment_job_created_at < job.created_at`) — material đã đổi nên job
 *     mới PHẢI chiếm được row. Ghi theo guard, KHÔNG ghi đè mù.
 *  Trả về false khi không nhánh nào khớp — KHÔNG coi là thành công.
 *  Chủ MỚI hơn thì job cũ không bao giờ ghi đè được (P1-1). */
async markMatchProcessing(job: EnrichmentJobRow): Promise<boolean> {
      const cols = {
        enrichment_status: "processing",
        enrichment_source: "auto_enrichment",
        enrichment_job_id: job.id,
        enrichment_fingerprint: job.material_input_hash,
        enrichment_job_created_at: job.created_at,
      };
      // Điểm bắt đầu chung: update + khoá radar/listing. Filter riêng từng nhánh
      // nằm SAU `.eq(...)` của update builder (không được `.eq` trước `.update`).
      const row = () => db.from("radar_matches").update(cols).eq("radar_id", job.radar_id).eq("external_id", job.external_id);
      // 1) Job đang sở hữu row.
      const owned = await row().eq("enrichment_job_id", job.id).select("id");
      if (owned.error) throw owned.error;
      if ((owned.data?.length ?? 0) > 0) return true;
      // 2) Chưa có job nào chiếm row VÀ chưa từng publish (fingerprint + checked_at
      // đều null). job_id bị xoá nhưng còn fingerprint thì không được cướp.
      const fresh = await row()
        .is("enrichment_job_id", null)
        .is("enrichment_fingerprint", null)
        .is("enrichment_checked_at", null)
        .in("enrichment_status", ["not_started", "pending"])
        .select("id");
      if (fresh.error) throw fresh.error;
      if ((fresh.data?.length ?? 0) > 0) return true;
      // 3) TAKEOVER: chủ hiện tại chứng minh được là CŨ HƠN job này.
      return takeOverMatchRow(db, job, cols);
    },

    // Check thủ công mới nhất: RPC bóc id đúng listing RỒI mới limit 1.
    // like hậu tố + limit 10 để URL mới hơn (…99111.htm) che mất 111.
    async latestManualCheckAt(externalId) {
      const { data, error } = await db.rpc("latest_manual_check_at", { p_external_id: externalId });
      if (error) throw error;
      return typeof data === "string" && data.length > 0 ? data : null;
    },

    async persistMatchEnrichment(job, patch: MatchEnrichmentPatch) {
      const cols = {
        enrichment_status: patch.status,
        enrichment_source: patch.source,
        enrichment_score: patch.score,
        enrichment_deal_type: patch.dealType,
        enrichment_is_ngop: patch.isNgoP,
        enrichment_confidence: patch.confidence,
        enrichment_checked_at: patch.checkedAt,
        enrichment_job_id: job.id,
        enrichment_fingerprint: job.material_input_hash,
        enrichment_job_created_at: job.created_at,
      };
      // CAS: chỉ job đang sở hữu row được publish.
      const owned = await db
        .from("radar_matches")
        .update(cols)
        .eq("radar_id", job.radar_id)
        .eq("external_id", job.external_id)
        .eq("enrichment_job_id", job.id)
        .select("id");
      if (owned.error) throw owned.error;
      if ((owned.data?.length ?? 0) > 0) return true;
      // Job mới hơn chủ hiện tại (fingerprint khác) vẫn publish được, nhưng CHỈ
      // qua guard takeover — không xoá CAS, không ghi đè mù.
      return takeOverMatchRow(db, job, cols);
    },
  };
}

/** TAKEOVER ownership của radar_matches (P1-1).
 *  Row đang do job KHÁC sở hữu, nhưng job đó CỨ HƠN job này -> job này được
 *  chiếm row bằng MỘT write có guard. Guard: `enrichment_job_created_at <
 *  job.created_at` (và job này phải có created_at hợp lệ) — không chứng minh
 *  được "mới hơn" thì không được đè, nên job CŨ của fingerprint cũ không bao
 *  giờ ghi đè được kết quả của job mới.
 *  Row chưa từng ghi `enrichment_job_created_at` (do code TRƯỚC migration 0021)
 *  thì không takeover được — chấp nhận được vì 0021 đi KÈM code này, mọi row ghi
 *  sau deploy đều có tuổi. Nếu sau này cần mở khoá: join auto_enrichment_jobs
 *  để lấy created_at của job chủ, hoặc fallback enrichment_checked_at. */
async function takeOverMatchRow(
  db: SupabaseClient,
  job: EnrichmentJobRow,
  cols: Record<string, unknown>,
): Promise<boolean> {
  if (!(Date.parse(job.created_at) > 0)) return false;
  const older = await db
    .from("radar_matches")
    .update(cols)
    .eq("radar_id", job.radar_id)
    .eq("external_id", job.external_id)
    .lt("enrichment_job_created_at", job.created_at)
    .select("id");
  if (older.error) throw older.error;
  return (older.data?.length ?? 0) > 0;
}
