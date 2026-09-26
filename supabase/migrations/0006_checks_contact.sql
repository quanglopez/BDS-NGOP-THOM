-- Thêm thông tin người đăng + SĐT + link tin vào lịch sử check
-- Chạy 1 lần trong Supabase Dashboard -> SQL Editor (idempotent)

alter table public.checks
  add column if not exists phone text,
  add column if not exists contact_name text,
  add column if not exists listing_url text;
