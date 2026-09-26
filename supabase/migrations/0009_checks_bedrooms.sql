-- Thêm số phòng ngủ vào lịch sử check (trích từ text tin)
-- Chạy 1 lần trong Supabase Dashboard -> SQL Editor (idempotent)

alter table public.checks add column if not exists bedrooms integer;
