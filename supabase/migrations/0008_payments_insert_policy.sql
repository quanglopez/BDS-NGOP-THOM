-- Sửa ràng buộc thanh toán để luồng nâng gói chạy được:
-- 1) user cần tự INSERT bản ghi thanh toán pending (RLS trước đây chỉ có SELECT -> /api/payments/create bị chặn)
-- 2) cho phép trạng thái 'unmatched' + plan 'unmatched' (tiền vào không khớp vẫn phải có dấu vết)
-- Chạy 1 lần trong Supabase Dashboard -> SQL Editor (idempotent)

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments drop constraint if exists payments_plan_check;

alter table public.payments
  add constraint payments_status_check check (status in ('pending', 'paid', 'unmatched')),
  add constraint payments_plan_check check (plan in ('pro', 'team', 'unmatched'));

drop policy if exists "payments_insert_own" on public.payments;
create policy "payments_insert_own"
  on public.payments for insert
  with check (auth.uid() = user_id);
