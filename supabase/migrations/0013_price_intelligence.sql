-- P1: Price Intelligence + Comparable — price-v1
-- CHẠY 1 LẦN trong Supabase Dashboard -> SQL Editor. Chưa chạy khi file này được tạo.
--
-- Mục tiêu: lưu dữ liệu giá chào bán thật từ gateway Chợ Tốt để dựng "Phân tích giá
-- tham chiếu" cho Pro. KHÔNG phải giá giao dịch thực tế.
--
-- Nguyên tắc giữ nguyên từ Pro Analysis:
-- - Không UPDATE bảng checks (checks.price_intelligence là snapshot bất biến).
-- - Không bịa số: mọi cột thống kê đều kèm sample_size / trimmed_size.
-- - RLS bật nhưng KHÔNG tạo policy => chỉ service-role đọc/ghi, client không đụng tới.
-- - idempotent: chạy lại nhiều lần không sao.

-- ============================================================================
-- 1) CACHE CRAWL — 1 dòng = 1 quan sát giá chào bán
-- ============================================================================
create table if not exists public.market_listings (
  id               uuid primary key default gen_random_uuid(),
  source           text    not null,                 -- 'chotot_gateway'
  external_id      text    not null,                 -- ad.list_id
  category_code    integer,                          -- 1000 đất / 1010 căn hộ / 1020 nhà ở
  category_name    text,

  -- Địa lý gateway chỉ có 2 tầng: region = tỉnh, area = quận/phường
  region_name      text,
  region_v2        integer,
  area_name        text,
  area_v2          integer,

  title            text,
  price_vnd        bigint,
  size_m2          numeric,
  living_size_m2   numeric,
  land_front_m     numeric,
  land_side_m      numeric,
  rooms            integer,

  -- TÍNH LẠI từ price_vnd / size_m2. KHÔNG dùng ad.price_million_per_m2 của gateway.
  price_per_m2     numeric not null,

  lat              numeric,
  lng              numeric,
  listed_at        timestamptz,                     -- ad.list_time (epoch ms)
  url              text,

  -- Cờ chất lượng
  is_price_valid   boolean not null default true,    -- !ad.is_price_not_valid
  is_promoted      boolean not null default false,   -- is_sticky | company_ad | job_tier
  is_rent          boolean not null default false,   -- ad.type != 's'

  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),

  unique (source, external_id)
);

-- Truy vấn scope: cùng phường + cùng loại + cùng band diện tích
create index if not exists market_listings_scope_idx
  on public.market_listings (area_v2, category_code, size_m2, last_seen_at desc);

-- Cặp (area_name, area_v2) là bảng tra ward -> area_v2, dựng từ chính dữ liệu đã crawl
create index if not exists market_listings_area_idx
  on public.market_listings (area_name, region_name, area_v2);

alter table public.market_listings enable row level security;

comment on table public.market_listings is
  'Cache crawl gia cho ban tu tin dang. KHONG dung lam gia giao dich thuc te. stats bo qua is_promoted=true.';
comment on column public.market_listings.price_per_m2 is
  'Tinh lai tu price_vnd / size_m2. KHONG lay gia tri price_million_per_m2 cua gateway.';

-- ============================================================================
-- 2) SNAPSHOT THONG KE — 1 dong = 1 scope + 1 ngay
--    Primary key (scope_key, stat_date) vua la cache key vua la khoa chong crawl trung.
-- ============================================================================
create table if not exists public.market_price_stats (
  scope_key           text    not null,   -- vd: ward:13101|cat:1020|size:33-56|rooms:3
  stat_date           date    not null,

  scope_level         text    not null check (scope_level in ('ward', 'province')),
  scope_description   text    not null,   -- chuoi cho UI, vd: "Phuong 13, Quan 6, TP.HCM"
  region_name         text,
  area_name           text,
  category_code       integer,
  size_min_m2         numeric,
  size_max_m2         numeric,
  rooms               integer,

  sample_size         integer not null,   -- n sau khi loai tin rac, TRUOC trim
  trimmed_size        integer not null,   -- n sau trim IQR
  excluded_promoted   integer not null default 0,
  excluded_invalid    integer not null default 0,

  p25_ppm2            numeric,
  median_ppm2         numeric,
  p75_ppm2            numeric,
  min_ppm2            numeric,
  max_ppm2            numeric,

  -- 0..1: do tin cay cua mau. Tinh o pipeline (xem lib/price/stats.ts).
  -- null = chua tinh duoc. KHONG ghi so gia khi khong xac dinh duoc.
  quality_score       numeric,

  source              text    not null default 'chotot_gateway',
  computed_at         timestamptz not null default now(),

  primary key (scope_key, stat_date)
);

create index if not exists market_price_stats_date_idx
  on public.market_price_stats (stat_date desc, scope_level);

alter table public.market_price_stats enable row level security;

comment on column public.market_price_stats.quality_score is
  '0..1 diem chat luong mau. Tinh tu sample_size, trimmed ratio, scope_level. NULL = chua xac dinh.';
comment on column public.market_price_stats.median_ppm2 is
  'KHONG dung mean. KHONG gia tri khi trimmed_size < 15.';

-- ============================================================================
-- 3) SNAPSHOT GAC VOI CHECK — bat bien, khong regenerate
-- ============================================================================
alter table public.checks
  add column if not exists ward_name text,            -- tu category scan hoac tu URL nhatot
  add column if not exists region_name text,
  add column if not exists price_intelligence jsonb,
  add column if not exists price_intelligence_version text,
  add column if not exists price_intelligence_at timestamptz;

comment on column public.checks.price_intelligence is
  'Snapshot price-v1 tai thoi diem generate. CO gia tri = report hien thi dung so do. NULL = chua co. Khong tinh lai.';
comment on column public.checks.price_intelligence_version is
  'Schema/business logic cua snapshot gia. NULL = chua xac dinh (khong ghi version gia).';
comment on column public.checks.ward_name is
  'Chi luu khi biet chac tu category scan hoac parse tu URL Chotot. Khong fuzzy match tu text tin.';
