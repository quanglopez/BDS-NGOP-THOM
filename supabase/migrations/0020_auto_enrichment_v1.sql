-- Auto-Enrichment V1: bảo toàn signal thủ công và trace nguồn
create table if not exists public.auto_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  radar_id uuid not null references public.radars(id) on delete cascade,
  external_id text not null,
  material_input_hash text not null,
  material_input jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','completed','insufficient_data','low_confidence','failed')),
  attempts integer not null default 0,
  dispatch_started_at timestamptz,
  allowance_consumed boolean not null default false,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists auto_enrichment_jobs_unique_active on public.auto_enrichment_jobs(radar_id, external_id, material_input_hash) where status in ('pending','processing');
create index if not exists auto_enrichment_jobs_user_status_idx on public.auto_enrichment_jobs(user_id,status,created_at desc);

alter table public.radar_matches
  add column if not exists enrichment_status text not null default 'not_started' check (enrichment_status in ('not_started','pending','processing','completed','insufficient_data','low_confidence','failed')),
  add column if not exists enrichment_source text check (enrichment_source in ('auto_enrichment','manual_check')),
  add column if not exists enrichment_score integer,
  add column if not exists enrichment_deal_type text,
  add column if not exists enrichment_is_ngop integer,
  add column if not exists enrichment_confidence text,
  add column if not exists enrichment_checked_at timestamptz,
  add column if not exists enrichment_job_id uuid;
