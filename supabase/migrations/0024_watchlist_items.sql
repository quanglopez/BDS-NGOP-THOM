-- Watchlist V1: lưu tin theo dõi (từ report đã check HOẶC từ Radar).
-- TRẠNG THÁI: migration 0024 ĐÃ được apply trên production qua Supabase Dashboard ->
-- SQL Editor và đã verify trực tiếp: bảng watchlist_items tồn tại; RLS, policies,
-- functions, trigger và grants đều PASS. Không cần chạy lại khi deploy code.
--
-- Bất biến thiết kế:
-- - Mỗi item có ĐÚNG 1 anchor: check_id (report đã check) HOẶC market_listing_id
--   (tin lưu từ Radar — KHÔNG gọi /api/check, KHÔNG trừ quota).
-- - Anchor + snapshot tin BẤT BIẾN sau INSERT: trigger freeze + column-level
--   UPDATE grant (2 tầng độc lập, không dựa vào API whitelist).
-- - market_listings: KHÔNG mở quyền đọc cho authenticated. RLS INSERT policy
--   dùng SECURITY DEFINER helper tự scope theo auth.uid().
-- - Idempotent: if not exists / drop policy if exists / create or replace.

-- ============================================================================
-- 1) BẢNG
-- ============================================================================
create table if not exists public.watchlist_items (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,

  -- Anchor 1: report/check đã tồn tại.
  -- ON DELETE CASCADE giữ nguyên — audit xác nhận `checks` KHÔNG có đường xoá:
  -- không có policy delete, không có .delete() trong code, không có prune SQL.
  -- Chỉ cascade khi auth.users bị xoá (lúc đó watchlist cũng phải xoá theo).
  check_id            uuid references public.checks(id) on delete cascade,

  -- Anchor 2: tin trên Radar. ON DELETE RESTRICT (KHÔNG cascade): item đã lưu
  -- phải được bảo vệ khỏi cleanup/prune market_listings ngoài ý muốn. Cleanup
  -- muốn xoá listing phải xử lý watchlist trước — đây là ma sát cố ý.
  market_listing_id   uuid references public.market_listings(id) on delete restrict,

  -- Snapshot hiển thị cho item lưu từ Radar (market_listings không đọc được
  -- bằng session client nên phải chụp lại tại thời điểm lưu).
  listing_title       text,
  listing_url         text,
  listing_price_vnd   bigint,
  listing_size_m2     numeric,
  listing_area_name   text,
  listing_region_name text,

  status              text not null default 'moi_luu'
                      check (status in ('moi_luu','can_goi','da_goi','dang_theo','bo_qua')),
  note                text check (note is null or char_length(note) <= 500),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Đúng 1 anchor: không cho vừa check vừa listing, cũng không cho cả hai null.
  constraint watchlist_one_anchor
    check (num_nonnulls(check_id, market_listing_id) = 1),

  -- Chống duplicate. NULL trong UNIQUE là distinct nên 2 unique không đá nhau:
  -- item check (market_listing_id null) không đụng item listing (check_id null).
  unique (user_id, check_id),
  unique (user_id, market_listing_id)
);

create index if not exists watchlist_items_user_idx
  on public.watchlist_items (user_id, updated_at desc);

comment on table public.watchlist_items is
  'Tin user luu theo doi. Dung 1 anchor (check_id XOR market_listing_id). Anchor bat bien sau INSERT.';
comment on column public.watchlist_items.market_listing_id is
  'FK RESTRICT co y: listing da duoc luu khong bi cleanup xoa theo.';
comment on column public.watchlist_items.status is
  'Canonical: moi_luu | can_goi | da_goi | dang_theo | bo_qua.';

-- ============================================================================
-- 2) HELPER CHO RLS (SECURITY DEFINER)
-- ============================================================================
-- Policy chạy dưới quyền role gọi (authenticated), mà market_listings bật RLS
-- và KHÔNG có policy -> subquery trực tiếp trong policy luôn thấy 0 dòng.
-- Hàm này chạy dưới quyền owner, CHỈ trả boolean, tự scope theo auth.uid() —
-- KHÔNG nhận tham số user nên kể cả gọi RPC trực tiếp cũng không thể hỏi về
-- dữ liệu của người khác (không có boolean oracle cross-user).
-- KHÔNG mở grant select trên market_listings: cache crawl là dữ liệu toàn cục,
-- không thuộc user nào (giữ nguyên boundary của migration 0013).
-- Lưu ý: join theo external_id giả định 1 source ('chotot_gateway'). Thêm
-- source thứ 2 phải thêm cột source vào radar_matches rồi siết hàm này.
create or replace function public.can_user_watch_market_listing(p_market_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.market_listings ml
    join public.radar_matches m on m.external_id = ml.external_id
    join public.radars r on r.id = m.radar_id
    where ml.id = p_market_listing_id
      and r.user_id = auth.uid()
  );
$$;

revoke all on function public.can_user_watch_market_listing(uuid) from public, anon;
grant execute on function public.can_user_watch_market_listing(uuid) to authenticated;

-- ============================================================================
-- 3) RLS POLICIES
-- ============================================================================
alter table public.watchlist_items enable row level security;

-- SELECT / DELETE: chỉ dòng của chính user.
drop policy if exists "watchlist_select_own" on public.watchlist_items;
create policy "watchlist_select_own" on public.watchlist_items
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "watchlist_delete_own" on public.watchlist_items;
create policy "watchlist_delete_own" on public.watchlist_items
  for delete to authenticated using (auth.uid() = user_id);

-- UPDATE: chỉ dòng của chính user. Anchor bất biến ép bởi 2 tầng khác:
-- column-level grant (mục 5) + trigger freeze (mục 4).
drop policy if exists "watchlist_update_own" on public.watchlist_items;
create policy "watchlist_update_own" on public.watchlist_items
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- INSERT: own + anchor phải thuộc sở hữu user.
-- Nhánh check dùng subquery trực tiếp (checks có policy select-own nên invoker
-- thấy được dòng của mình). Nhánh listing PHẢI dùng helper definer.
drop policy if exists "watchlist_insert_own" on public.watchlist_items;
create policy "watchlist_insert_own" on public.watchlist_items
  for insert to authenticated with check (
    auth.uid() = user_id and (
      (watchlist_items.check_id is not null and exists (
        select 1 from public.checks c
        where c.id = watchlist_items.check_id and c.user_id = auth.uid()))
      or
      (watchlist_items.market_listing_id is not null
        and public.can_user_watch_market_listing(watchlist_items.market_listing_id))
    )
  );

-- ============================================================================
-- 4) TRIGGER FREEZE ANCHOR
-- ============================================================================
-- Chạy cho MỌI role (kể cả service_role): tương lai có grant ẩu vẫn không sửa
-- được anchor/snapshot. status/note/updated_at nằm ngoài danh sách freeze.
create or replace function public.watchlist_items_freeze_anchor()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.user_id             is distinct from old.user_id
  or new.check_id            is distinct from old.check_id
  or new.market_listing_id   is distinct from old.market_listing_id
  or new.created_at          is distinct from old.created_at
  or new.listing_title       is distinct from old.listing_title
  or new.listing_url         is distinct from old.listing_url
  or new.listing_price_vnd   is distinct from old.listing_price_vnd
  or new.listing_size_m2     is distinct from old.listing_size_m2
  or new.listing_area_name   is distinct from old.listing_area_name
  or new.listing_region_name is distinct from old.listing_region_name
  then
    raise exception 'watchlist_items: anchor fields are immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists watchlist_items_freeze_anchor on public.watchlist_items;
create trigger watchlist_items_freeze_anchor
  before update on public.watchlist_items
  for each row
  execute function public.watchlist_items_freeze_anchor();

-- Hàm trigger không qua ACL runtime khi fire; revoke là hygiene (không gọi trực
-- tiếp được — hàm return trigger chỉ chạy được như trigger).
revoke all on function public.watchlist_items_freeze_anchor() from public, anon, authenticated;
grant execute on function public.watchlist_items_freeze_anchor() to service_role;

-- ============================================================================
-- 5) GRANTS — privilege tối thiểu (pattern 0020)
-- ============================================================================
-- anon: không có gì.
-- authenticated: select/insert/delete + UPDATE CHỈ 3 cột (status/note/updated_at).
--   Đổi anchor/snapshot bị chặn ngay ở tầng quyền; trigger là tầng 2.
-- service_role: toàn quyền (worker/cron đi qua 1 đường).
revoke all on public.watchlist_items from anon;
revoke all on public.watchlist_items from authenticated;
grant select, insert, delete on public.watchlist_items to authenticated;
grant update (status, note, updated_at) on public.watchlist_items to authenticated;
grant all on public.watchlist_items to service_role;
