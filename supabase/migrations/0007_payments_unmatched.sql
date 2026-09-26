-- Giao dịch chuyển khoản không khớp nội dung / sai số tiền vẫn phải được ghi lại
-- để admin đối chiếu và xử lý tay (trước đây bị bỏ qua im lặng = mất dấu tiền).
-- Chạy 1 lần trong Supabase Dashboard -> SQL Editor (idempotent)

alter table public.payments alter column user_id drop not null;

-- Giao dịch chưa nhận diện được người chuyển
comment on column public.payments.user_id is 'NULL khi chưa nhận diện được người chuyển (status=unmatched)';
