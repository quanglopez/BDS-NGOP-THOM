// Adapter Supabase cho enrichment worker.
// - Claim + charge + attempts: qua RPC security definer (atomic, không SELECT->UPDATE).
// - Persist kết quả: bảng radar_matches, CHỈ ghi cột enrichment_* — không bao giờ
//   đụng score/deal_type/is_ngop của signal thủ công.

import type { SupabaseClient } from "@supabase/supabase-js";
import { effectivePlan } from "@/lib/quota";
import { AUTO_ENRICHMENT_DAILY_LIMIT } from "./auto-enrollment";
import { listingIdFromUrl } from "./signals";
import type { EnrichmentJobRow, EnrichmentWorkerStore, MatchEnrichmentPatch } from "./enrichment-worker";

export function createSupabaseEnrichmentStore(db: SupabaseClient): EnrichmentWorkerStore {
  const nowISO = () => new Date().toISOString();

  return {
    // Quá lease -> trả về pending (còn lượt) hoặc failed (hết lượt). Idempotent.
    async reclaimStaleProcessing(cutoffISO, maxAttempts) {
      const requeued = await db
        .from("auto_enrichment_jobs")
        .update({
          status: "pending",
          claim_token: null,
          processing_started_at: null,
          next_attempt_at: nowISO(),
          error_kind: "lease_expired",
          last_error: "lease_expired",
          updated_at: nowISO(),
        })
        .eq("status", "processing")
        .lt("processing_started_at", cutoffISO)
        .lt("attempts", maxAttempts)
        .select("id");
      if (requeued.error) throw requeued.error;

      const dead = await db
        .from("auto_enrichment_jobs")
        .update({
          status: "failed",
          claim_token: null,
          processing_started_at: null,
          error_kind: "lease_expired",
          last_error: "lease_expired",
          updated_at: nowISO(),
        })
        .eq("status", "processing")
        .lt("processing_started_at", cutoffISO)
        .gte("attempts", maxAttempts)
        .select("id");
      if (dead.error) throw dead.error;

      return { requeued: requeued.data?.length ?? 0, failed: dead.data?.length ?? 0 };
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
      const { data, error } = await db.rpc("begin_auto_enrichment_dispatch", {
        p_job_id: job.id,
        p_claim_token: job.claim_token,
        p_daily_limit: AUTO_ENRICHMENT_DAILY_LIMIT,
      });
      if (error) throw error;
      return data === true;
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
      const { error: updateError } = await db
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
    },

    async markMatchProcessing(job: EnrichmentJobRow): Promise<void> {
      // Chỉ đổi trạng thái hiển thị; KHÔNG đụng enrichment_score/deal_type/is_ngop
      // (giữ nguyên null của lần chạy trước) và không chạm cột manual.
      const { error } = await db
        .from("radar_matches")
        .update({
          enrichment_status: "processing",
          enrichment_source: "auto_enrichment",
          enrichment_job_id: job.id,
          enrichment_fingerprint: job.material_input_hash,
        })
        .eq("radar_id", job.radar_id)
        .eq("external_id", job.external_id);
      if (error) throw error;
    },

    // Check thủ công mới nhất của 1 listing: chỉ lấy Check ĐÃ chấm, lọc chính xác
    // external_id để tránh trùng hậu tố số (123456 vs 23456).
    async latestManualCheckAt(externalId) {
      const { data, error } = await db
        .from("checks")
        .select("listing_url,created_at")
        .not("score", "is", null)
        .like("listing_url", `%${externalId}.htm`)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      for (const row of data ?? []) {
        if (listingIdFromUrl(row.listing_url) === externalId && typeof row.created_at === "string") {
          return row.created_at;
        }
      }
      return null;
    },

    async persistMatchEnrichment(job, patch: MatchEnrichmentPatch) {
      const { error } = await db
        .from("radar_matches")
        .update({
          enrichment_status: patch.status,
          enrichment_source: patch.source,
          enrichment_score: patch.score,
          enrichment_deal_type: patch.dealType,
          enrichment_is_ngop: patch.isNgoP,
          enrichment_confidence: patch.confidence,
          enrichment_checked_at: patch.checkedAt,
          enrichment_job_id: job.id,
          enrichment_fingerprint: job.material_input_hash,
        })
        .eq("radar_id", job.radar_id)
        .eq("external_id", job.external_id);
      if (error) throw error;
    },
  };
}
