-- Keo Radar V1
create table if not exists public.radars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  area_v2 integer not null, area_name text, region_name text, category_code integer,
  price_min_vnd bigint, price_max_vnd bigint, area_min_m2 numeric, area_max_m2 numeric,
  min_score integer, deal_types text[] not null default '{}', ngop_only boolean not null default false,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','PAUSED')),
  checked_at timestamptz, last_seen_at timestamptz, new_match_count integer not null default 0,
  coverage_status text not null default 'unknown' check (coverage_status in ('ok','thin','none','unknown')),
  coverage_listing_count integer, coverage_freshness text,
  coverage_staleness text not null default 'unknown' check (coverage_staleness in ('fresh','stale','unknown')),
  coverage_source text not null default 'chotot_gateway', coverage_description text,
  excluded_count integer, last_scan_count integer, last_scan_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists radars_user_idx on public.radars(user_id,status,updated_at desc);
create index if not exists radars_area_idx on public.radars(area_v2,status);
create table if not exists public.radar_matches (
  id uuid primary key default gen_random_uuid(),
  radar_id uuid not null references public.radars(id) on delete cascade,
  external_id text not null, url text, title text, area_name text, region_name text,
  category_code integer, price_vnd bigint, size_m2 numeric, price_per_m2 numeric,
  listed_at timestamptz, last_seen_at timestamptz, score integer, deal_type text, is_ngop integer,
  scoring_available boolean not null default false, median_ppm2 numeric, difference_percent numeric,
  confidence text, scope_description text, first_matched_at timestamptz not null default now(),
  last_matched_at timestamptz not null default now(), created_at timestamptz not null default now(),
  unique(radar_id,external_id)
);
create index if not exists radar_matches_radar_idx on public.radar_matches(radar_id,last_matched_at desc);
alter table public.radars enable row level security;
alter table public.radar_matches enable row level security;
drop policy if exists "radars_select_own" on public.radars;
create policy "radars_select_own" on public.radars for select using (auth.uid()=user_id);
drop policy if exists "radars_insert_own" on public.radars;
create policy "radars_insert_own" on public.radars for insert with check (auth.uid()=user_id);
drop policy if exists "radars_update_own" on public.radars;
create policy "radars_update_own" on public.radars for update using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists "radars_delete_own" on public.radars;
create policy "radars_delete_own" on public.radars for delete using (auth.uid()=user_id);
drop policy if exists "radar_matches_select_own" on public.radar_matches;
create policy "radar_matches_select_own" on public.radar_matches for select using (
  exists(select 1 from public.radars r where r.id=radar_matches.radar_id and r.user_id=auth.uid())
);