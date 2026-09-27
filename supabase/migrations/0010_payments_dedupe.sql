-- Chống ghi trùng giao dịch: SePay có thể gửi lại webhook (retry, gửi tay).
-- SePay khuyến nghị chặn trùng theo trường `id` trong payload.
-- Index unique chỉ áp dụng cho dòng đã paid, nên dòng unmatched/pending vẫn ghi được bình thường.

create unique index if not exists payments_paid_ref_uniq
  on public.payments (sepay_ref)
  where status = 'paid' and sepay_ref is not null;
