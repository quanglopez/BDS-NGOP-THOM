-- Thêm cột ref_code để tìm user theo mã giới thiệu nhanh và chắc chắn
-- Chạy 1 lần trong Supabase Dashboard -> SQL Editor (idempotent)

alter table public.users add column if not exists ref_code text;

-- Backfill cho các user đã đăng nhập trước đó
update public.users
set ref_code = left(replace(id::text, '-', ''), 8)
where ref_code is null;

create unique index if not exists users_ref_code_idx on public.users (ref_code);

-- Trigger tự set ref_code cho user mới
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, phone, name, ref_code)
  values (
    new.id,
    new.phone,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    left(replace(new.id::text, '-', ''), 8)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
