-- Phase 12: Application Score Cache cho /api/check (manual check flow).
-- Backward compatible: cả hai cột nullable, NULL = cache miss (rows cũ
-- tự động là miss). KHÔNG backfill.
alter table public.checks
  add column if not exists scoring_cache_key text,
  add column if not exists provider_model_id text;

-- Một row cache duy nhất cho mỗi (user, canonical request). Hit trả lại
-- chính row này (cùng check_id, cùng score). Request song song cùng key
-- -> insert loser bị 23505 -> route fallback SELECT winner.
create unique index if not exists checks_scoring_cache_key_uidx
  on public.checks (user_id, scoring_cache_key)
  where scoring_cache_key is not null;

comment on column public.checks.scoring_cache_key is
  'SHA-256(JSON canonical Jev request + SCORING_CODE_VERSION). NULL = row not cache-eligible.';
comment on column public.checks.provider_model_id is
  'Model Jev thật sự trả về (body model, fallback header x-model). NULL = provider không báo.';
