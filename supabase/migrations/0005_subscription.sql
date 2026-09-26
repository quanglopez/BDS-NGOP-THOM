-- Gói Pro/Team có hạn 30 ngày. Hết hạn thì tự động về Free.
-- Chạy trong Supabase Dashboard -> SQL Editor (idempotent)

alter table public.users add column if not exists plan_expires_at timestamptz;

-- User đã trả tiền trước khi có cơ chế hạn: cho 30 ngày từ hôm nay
update public.users
set plan_expires_at = now() + interval '30 days'
where plan <> 'free' and plan_expires_at is null;

create index if not exists users_plan_expires_idx
  on public.users (plan_expires_at)
  where plan <> 'free';
