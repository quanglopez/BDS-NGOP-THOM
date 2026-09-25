-- Bảng leads: thu email + SĐT từ form "Dùng thử miễn phí"
-- Chạy trong Supabase Dashboard -> SQL Editor (idempotent)

create table if not exists public.leads (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  phone      text,
  source     text not null default 'landing',
  plan_interest text,
  created_at timestamptz not null default now()
);

create index if not exists leads_created_idx on public.leads (created_at desc);

-- RLS bật nhưng không cấp quyền đọc cho client: chỉ service role (webhook/admin) đọc được
alter table public.leads enable row level security;
