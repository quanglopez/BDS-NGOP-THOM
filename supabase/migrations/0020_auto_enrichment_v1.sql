-- Auto-Enrichment V1: bảo toàn signal thủ công, trace nguồn, worker an toàn.
--
-- Bất biến:
-- - enqueue KHÔNG charge; charge đúng 1 tại dispatch đầu tiên (trong RPC).
-- - Cap ngày 200/user enforced atomic bằng bảng allowance (PK user_id+day).
-- - claim job atomic bằng FOR UPDATE SKIP LOCKED; worker đồng thời không trùng job.
-- - RLS: user chỉ SELECT job của mình; mọi ghi đi qua service role.
-- - Mọi câu lệnh idempotent (if not exists / drop policy if exists / create or replace).

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

-- Cột vòng đời worker: lease chống crash, retry có lịch, claim token chống 2 worker.
alter table public.auto_enrichment_jobs
  add column if not exists processing_started_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists claim_token uuid,
  add column if not exists error_kind text;

create unique index if not exists auto_enrichment_jobs_unique_active on public.auto_enrichment_jobs(radar_id, external_id, material_input_hash) where status in ('pending','processing');
create index if not exists auto_enrichment_jobs_user_status_idx on public.auto_enrichment_jobs(user_id,status,created_at desc);
create index if not exists auto_enrichment_jobs_claim_idx on public.auto_enrichment_jobs(status, next_attempt_at) where status = 'pending';
create index if not exists auto_enrichment_jobs_processing_idx on public.auto_enrichment_jobs(processing_started_at) where status = 'processing';
create index if not exists auto_enrichment_jobs_user_dispatch_idx on public.auto_enrichment_jobs(user_id, dispatch_started_at);

-- Allowance theo ngày (giờ VN): 1 dòng/user/ngày, cap ngày enforce khi tăng.
create table if not exists public.auto_enrichment_allowance (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  consumed integer not null default 0,
  primary key (user_id, day)
);

-- RLS: bảng allowance không cho client đọc/ghi — chỉ service role.
alter table public.auto_enrichment_allowance enable row level security;
revoke all on public.auto_enrichment_allowance from anon, authenticated;

-- RLS jobs: user chỉ thấy job của mình; không có policy ghi -> client không mutate được.
alter table public.auto_enrichment_jobs enable row level security;
drop policy if exists "auto_enrichment_jobs_select_own" on public.auto_enrichment_jobs;
create policy "auto_enrichment_jobs_select_own" on public.auto_enrichment_jobs
  for select to authenticated using (auth.uid() = user_id);
-- Privilege tối thiểu: anon không có gì; authenticated CHỈ SELECT (theo RLS).
-- revoke all TRƯỚC để bỏ cả TRUNCATE/REFERENCES/TRIGGER mà `revoke insert,update,delete`
-- không chạm tới (RLS không bảo vệ TRUNCATE).
revoke all on public.auto_enrichment_jobs from anon;
revoke all on public.auto_enrichment_jobs from authenticated;
grant select on public.auto_enrichment_jobs to authenticated;
-- service_role (bypass RLS) giữ toàn quyền để worker/cron đi qua đúng 1 đường.
grant all on public.auto_enrichment_jobs to service_role;
grant all on public.auto_enrichment_allowance to service_role;

-- Claim atomic: lấy tối đa p_limit job pending đến hạn, khoá SKIP LOCKED để
-- worker đồng thời không bao giờ claim trùng. Trả luôn dòng đã claim.
create or replace function public.claim_auto_enrichment_jobs(p_limit integer)
returns setof public.auto_enrichment_jobs
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.auto_enrichment_jobs j
  set status = 'processing',
      claim_token = gen_random_uuid(),
      processing_started_at = now(),
      updated_at = now()
  where j.id in (
    select id
    from public.auto_enrichment_jobs
    where status = 'pending'
      and (next_attempt_at is null or next_attempt_at <= now())
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 10), 100))
    for update skip locked
  )
  returning j.*;
$$;

-- Bắt đầu 1 dispatch: lần đầu charge allowance (atomic, cap ngày), mọi lần tăng
-- attempts. false = hết cap hoặc mất claim -> worker release/failed.
create or replace function public.begin_auto_enrichment_dispatch(
  p_job_id uuid,
  p_claim_token uuid,
  p_daily_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_needs_charge boolean;
  v_consumed integer;
  v_day date;
begin
  select user_id, dispatch_started_at is null
  into v_user, v_needs_charge
  from public.auto_enrichment_jobs
  where id = p_job_id
    and claim_token = p_claim_token
    and status = 'processing'
  for update;
  if v_user is null then
    return false;
  end if;

  if v_needs_charge then
    if coalesce(p_daily_limit, 0) < 1 then
      return false;
    end if;
    v_day := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
    insert into public.auto_enrichment_allowance(user_id, day, consumed)
    values (v_user, v_day, 1)
    on conflict (user_id, day) do update
      set consumed = public.auto_enrichment_allowance.consumed + 1
      where public.auto_enrichment_allowance.consumed < p_daily_limit
    returning consumed into v_consumed;
    if v_consumed is null then
      return false;
    end if;
    update public.auto_enrichment_jobs
       set dispatch_started_at = now(), allowance_consumed = true
     where id = p_job_id and claim_token = p_claim_token;
  end if;

  update public.auto_enrichment_jobs
     set attempts = attempts + 1, updated_at = now()
   where id = p_job_id and claim_token = p_claim_token and status = 'processing';
  if not found then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.claim_auto_enrichment_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_auto_enrichment_jobs(integer) to service_role;
revoke all on function public.begin_auto_enrichment_dispatch(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.begin_auto_enrichment_dispatch(uuid, uuid, integer) to service_role;

alter table public.radar_matches
  add column if not exists enrichment_status text not null default 'not_started' check (enrichment_status in ('not_started','pending','processing','completed','insufficient_data','low_confidence','failed')),
  add column if not exists enrichment_source text check (enrichment_source in ('auto_enrichment','manual_check')),
  add column if not exists enrichment_score integer,
  add column if not exists enrichment_deal_type text,
  add column if not exists enrichment_is_ngop integer,
  add column if not exists enrichment_confidence text,
  add column if not exists enrichment_checked_at timestamptz,
  add column if not exists enrichment_job_id uuid,
  add column if not exists enrichment_fingerprint text;
