-- P1 Price Intelligence: cho phep tầng QUẬN ghi vào market_price_stats.
--
-- VI SAO CAN:
-- Migration 0013 tao bang voi check
--   scope_level in ('ward', 'province')
-- nhung code (lib/price/types.ts) da co ScopeLevel = 'ward' | 'district' |
-- 'province' tu khi them fallback phuong -> quan (f7b11ba). Insert tầng quận
-- chắc chắn bi 23514 check_violation.
--
-- He qua khong phai "thieu so" ma la SAI: claim() nhan loi insert bat ky
-- nao cung tra false, nen tầng quận bi coi nhu "nguoi khac dang giu khoa",
-- doc lai cung khong co dong -> tra null, roi lui xuong tinh. Report chi
-- bao "chua du mau" trong khi du lieu quận co san. Constraint la hang rao
-- nen pipeline ngoai DB khong the nao loi ra duoc.
--
-- Khong sua migration da duyet (0013). Idempotent: drop co if exists, va
-- them lai cung ten nen chay lai van ra cung ket qua.

alter table public.market_price_stats
  drop constraint if exists market_price_stats_scope_level_check;

alter table public.market_price_stats
  add constraint market_price_stats_scope_level_check
  check (scope_level in ('ward', 'district', 'province'));

comment on column public.market_price_stats.scope_level is
  'Cap pham vi thong ke: ward | district | province. district = tầng mở rộng khi phường không đủ mẫu (xem lib/price/pipeline.ts widenToDistrict).';
