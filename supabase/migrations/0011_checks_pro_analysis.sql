-- Cache phân tích Pro (OpenRouter) theo từng lần check — idempotent.
-- Report lịch sử giữ snapshot: không regenerate tự động khi reload.
-- Chạy 1 lần trong Supabase Dashboard -> SQL Editor.

alter table public.checks
  add column if not exists analysis_json jsonb,
  add column if not exists analysis_version text,
  add column if not exists scoring_version text,
  add column if not exists ai_model text,
  add column if not exists ai_generated_at timestamptz;
