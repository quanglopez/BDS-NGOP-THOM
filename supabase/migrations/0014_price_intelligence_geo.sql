-- P1 Price Intelligence — nguồn dữ liệu địa lý cho việc dựng nhóm tham chiếu.
-- Tách riêng khỏi 0013 để không sửa migration đã duyệt.
-- CHẠY SAU 0013. Idempotent, không UPDATE bảng checks.
--
-- Vì sao cần: checks chỉ có `province` (tỉnh), chưa có phường. Không có phường thì
-- không dựng được nhóm tham chiếu cấp phường, chỉ lên được cấp tỉnh.
--
-- Nguồn được ghi lại để audit sau này biết dữ liệu lấy từ đâu:
--   'scan' = quét danh mục (scope.ward/scope.region)
--   'url'  = parse từ slug URL nhà tốt
--   null   = không xác định được -> KHÔNG suy đoán, fallback tỉnh

alter table public.checks
  add column if not exists ward_name text,
  add column if not exists region_name text,
  add column if not exists ward_source text check (ward_source in ('scan', 'url')),
  add column if not exists region_source text check (region_source in ('scan', 'url'));

create index if not exists checks_geo_idx
  on public.checks (region_name, ward_name)
  where price_intelligence is not null;

comment on column public.checks.ward_source is
  'scan | url | NULL. Ghi de audit; NULL = khong xac dinh duoc, da fallback ve tinh.';
comment on column public.checks.region_source is
  'scan | url | NULL. Ghi de audit; NULL = khong xac dinh duoc.';
comment on column public.checks.ward_name is
  'Chi luu khi biet tu category scan hoac khop ten da crawl trong market_listings. Khong fuzzy match tu text tin.';
