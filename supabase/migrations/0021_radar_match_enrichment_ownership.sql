-- Auto-Enrichment V1 (P1-1): ownership của radar_matches phải phân giải được
-- theo (radar_id, external_id, material_input_hash) + thứ tự job, nếu không job
-- của fingerprint MỚI sẽ không bao giờ publish được (row đóng băng trên
-- fingerprint cũ) trong khi allowance + lượt gọi AI vẫn bị tiêu cho job đó.
--
-- Bất biến:
-- - Chỉ THÊM một cột nullable; không đụng cột signal thủ công (score/deal_type/
--   is_ngop) và không đụng bất kỳ RLS/grant nào của 0019/0020.
-- - Không cần backfill: cột rỗng = "chủ cũ không ghi được tuổi", code xử lý được.
-- - Idempotent (add column if not exists).

alter table public.radar_matches
  add column if not exists enrichment_job_created_at timestamptz;
