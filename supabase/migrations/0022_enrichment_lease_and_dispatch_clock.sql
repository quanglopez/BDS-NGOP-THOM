-- Auto-Enrichment: giờ DB là đồng hồ reclaim/dispatch; Check thủ công khớp
-- đúng listing trước khi limit; scan không lật processing về pending.
--
-- Không thay chữ ký begin_auto_enrichment_dispatch (0020 đã grant). Hàm mới
-- đứng cạnh hàm cũ. Không nới RLS, không backfill, không đụng cột signal thủ công.
-- Idempotent. Chưa apply — deploy code gọi RPC mới phải đi cùng file này.

-- Lease hết hạn tính bằng now() của DB, không nhận timestamp từ app.
-- Requeue lùi tối thiểu 30s để cùng một tick không claim lại ngay.
-- Không xoá dispatch_started_at (giữ charge-once).
create or replace function public.reclaim_stale_auto_enrichment_jobs(
  p_lease_seconds integer,
  p_max_attempts integer,
  p_backoff_seconds integer
)
returns table (requeued integer, failed integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requeued integer;
  v_failed integer;
  v_backoff integer;
  v_lease integer;
begin
  v_lease := greatest(coalesce(p_lease_seconds, 1), 1);
  v_backoff := greatest(coalesce(p_backoff_seconds, 30), 30);

  update public.auto_enrichment_jobs
     set status = 'pending',
         claim_token = null,
         processing_started_at = null,
         next_attempt_at = now() + make_interval(secs => v_backoff),
         error_kind = 'lease_expired',
         last_error = 'lease_expired',
         updated_at = now()
   where status = 'processing'
     and processing_started_at < now() - make_interval(secs => v_lease)
     and attempts < coalesce(p_max_attempts, 3);
  get diagnostics v_requeued = row_count;

  update public.auto_enrichment_jobs
     set status = 'failed',
         claim_token = null,
         processing_started_at = null,
         error_kind = 'lease_expired',
         last_error = 'lease_expired',
         updated_at = now()
   where status = 'processing'
     and processing_started_at < now() - make_interval(secs => v_lease)
     and attempts >= coalesce(p_max_attempts, 3);
  get diagnostics v_failed = row_count;

  return query select v_requeued, v_failed;
end;
$$;

revoke all on function public.reclaim_stale_auto_enrichment_jobs(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.reclaim_stale_auto_enrichment_jobs(integer, integer, integer) to service_role;

-- Trả dispatch_started_at do DB ghi cho ĐÚNG lần dispatch này.
-- Lần đầu: charge rồi set now(). Retry: trả mốc cũ, không ghi now() mới, không charge lại.
-- null = mất claim hoặc hết cap.
create or replace function public.begin_auto_enrichment_dispatch_at(
  p_job_id uuid,
  p_claim_token uuid,
  p_daily_limit integer
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_dispatch timestamptz;
  v_consumed integer;
  v_day date;
begin
  select user_id, dispatch_started_at
    into v_user, v_dispatch
  from public.auto_enrichment_jobs
  where id = p_job_id
    and claim_token = p_claim_token
    and status = 'processing'
  for update;
  if v_user is null then
    return null;
  end if;

  if v_dispatch is null then
    if coalesce(p_daily_limit, 0) < 1 then
      return null;
    end if;
    v_day := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
    insert into public.auto_enrichment_allowance(user_id, day, consumed)
    values (v_user, v_day, 1)
    on conflict (user_id, day) do update
      set consumed = public.auto_enrichment_allowance.consumed + 1
      where public.auto_enrichment_allowance.consumed < p_daily_limit
    returning consumed into v_consumed;
    if v_consumed is null then
      return null;
    end if;
    update public.auto_enrichment_jobs
       set dispatch_started_at = now(), allowance_consumed = true
     where id = p_job_id and claim_token = p_claim_token
     returning dispatch_started_at into v_dispatch;
  end if;

  update public.auto_enrichment_jobs
     set attempts = attempts + 1, updated_at = now()
   where id = p_job_id and claim_token = p_claim_token and status = 'processing';
  if not found then
    return null;
  end if;
  return v_dispatch;
end;
$$;

revoke all on function public.begin_auto_enrichment_dispatch_at(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.begin_auto_enrichment_dispatch_at(uuid, uuid, integer) to service_role;

-- Check thủ công mới nhất của đúng listing. Bóc id trước .htm rồi mới limit 1.
-- Không like hậu tố + limit toàn cục (123 bị 99123 mới hơn che mất).
create or replace function public.latest_manual_check_at(p_external_id text)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.created_at
  from public.checks c
  where c.score is not null
    and substring(c.listing_url from '([0-9]+)\.htm($|[?#])') = p_external_id
  order by c.created_at desc
  limit 1;
$$;

revoke all on function public.latest_manual_check_at(text) from public, anon, authenticated;
grant execute on function public.latest_manual_check_at(text) to service_role;

-- Upsert scan gửi pending không được đè row worker vừa đặt processing.
-- Insert mới vẫn pending. completed / terminal khác không bị hàm này đụng.
create or replace function public.preserve_radar_match_processing()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.enrichment_status = 'processing' and new.enrichment_status = 'pending' then
    new.enrichment_status := old.enrichment_status;
    new.enrichment_source := old.enrichment_source;
  end if;
  return new;
end;
$$;

revoke all on function public.preserve_radar_match_processing() from public, anon, authenticated;
grant execute on function public.preserve_radar_match_processing() to service_role;

drop trigger if exists radar_matches_preserve_processing on public.radar_matches;
create trigger radar_matches_preserve_processing
  before update on public.radar_matches
  for each row
  execute function public.preserve_radar_match_processing();
