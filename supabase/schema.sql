-- Bảng users: profile môi giới gắn với auth.users của Supabase
-- Chạy đoạn này trong Supabase Dashboard -> SQL Editor

create table if not exists public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  phone      text,
  name       text,
  plan       text not null default 'free' check (plan in ('free', 'pro', 'team')),
  credits    integer not null default 20,
  created_at timestamptz not null default now()
);

-- RLS: user chỉ thấy/sửa được record của mình
alter table public.users enable row level security;

create policy "users_select_own"
  on public.users for select
  using (auth.uid() = id);

create policy "users_update_own"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- User mới đăng nhập (SĐT / Google) -> tự tạo profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, phone, name)
  values (
    new.id,
    new.phone,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lịch sử check: mỗi tin check thành công = 1 row
create table if not exists public.checks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  original_text text not null,
  score         integer,
  deal_type     text,
  is_ngop       integer,
  created_at    timestamptz not null default now()
);

create index if not exists checks_user_created_idx
  on public.checks (user_id, created_at desc);

alter table public.checks enable row level security;

create policy "checks_select_own"
  on public.checks for select
  using (auth.uid() = user_id);

create policy "checks_insert_own"
  on public.checks for insert
  with check (auth.uid() = user_id);
