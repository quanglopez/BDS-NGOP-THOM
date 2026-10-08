// Watchlist data layer — mọi truy vấn chấm user. Session client (RLS) là mặc
// định; adminClient CHỈ dùng để resolve market_listings global (bảng này không
// mở quyền đọc cho authenticated). Không import route AI / /api/check / quota.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WatchlistStatus } from "./types";

export interface WatchlistCheckDetail {
  id: string;
  title: string | null;
  seoSlug: string | null;
  score: number | null;
  dealType: string | null;
  isNgoP: number | null;
  province: string | null;
  priceBillion: number | null;
  areaM2: number | null;
  createdAt: string;
  listingUrl: string | null;
}

export interface WatchlistListingDetail {
  marketListingId: string;
  title: string | null;
  url: string | null;
  priceVnd: number | null;
  sizeM2: number | null;
  areaName: string | null;
  regionName: string | null;
}

// Unified view cho UI sau này: anchor 'check' trả check detail, 'listing' trả
// snapshot đã copy lúc lưu (market_listings không đọc được bằng session client).
export interface WatchlistEntry {
  id: string;
  status: WatchlistStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  anchor: "check" | "listing";
  check?: WatchlistCheckDetail | null;
  listing?: WatchlistListingDetail;
}

type Row = Record<string, unknown>;

const CHECK_DETAIL_COLUMNS =
  "id, original_text, seo_slug, score, deal_type, is_ngop, province, price_billion, area_m2, created_at, listing_url";

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function mapCheckDetail(row: Row): WatchlistCheckDetail {
  return {
    id: String(row.id),
    title: str(row.original_text),
    seoSlug: str(row.seo_slug),
    score: num(row.score),
    dealType: str(row.deal_type),
    isNgoP: num(row.is_ngop),
    province: str(row.province),
    priceBillion: num(row.price_billion),
    areaM2: num(row.area_m2),
    createdAt: String(row.created_at ?? ""),
    listingUrl: str(row.listing_url),
  };
}

function mapEntry(
  row: Row,
  checksById: Map<string, WatchlistCheckDetail>,
): WatchlistEntry {
  const checkId = str(row.check_id);
  const marketListingId = str(row.market_listing_id);
  if (checkId) {
    return {
      id: String(row.id),
      status: row.status as WatchlistStatus,
      note: str(row.note),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      anchor: "check",
      check: checkId ? checksById.get(checkId) ?? null : null,
    };
  }
  return {
    id: String(row.id),
    status: row.status as WatchlistStatus,
    note: str(row.note),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    anchor: "listing",
    listing: marketListingId
      ? {
          marketListingId,
          title: str(row.listing_title),
          url: str(row.listing_url),
          priceVnd: num(row.listing_price_vnd),
          sizeM2: num(row.listing_size_m2),
          areaName: str(row.listing_area_name),
          regionName: str(row.listing_region_name),
        }
      : undefined,
  };
}

/**
 * Nạp check detail cho MỘT checkId (helper dùng chung cho POST/PATCH/GET-by-check).
 * `checks` đọc bằng session client (RLS) — không đủ quyền/không có thì coi như
 * không hydrate được, KHÔNG dựng detail giả.
 */
async function loadCheckDetail(
  s: SupabaseClient,
  checkId: string,
): Promise<Map<string, WatchlistCheckDetail>> {
  const byId = new Map<string, WatchlistCheckDetail>();
  const { data, error } = await s
    .from("checks")
    .select(CHECK_DETAIL_COLUMNS)
    .eq("id", checkId)
    .maybeSingle();
  if (error) throw error;
  if (data) byId.set(String(data.id), mapCheckDetail(data));
  return byId;
}

export async function listWatchlist(
  s: SupabaseClient,
  userId: string,
): Promise<WatchlistEntry[]> {
  const { data, error } = await s
    .from("watchlist_items")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  const checkIds = (data ?? [])
    .map((r) => str(r.check_id))
    .filter((v): v is string => v !== null);
  const checksById = new Map<string, WatchlistCheckDetail>();
  if (checkIds.length) {
    const { data: checks, error: cErr } = await s
      .from("checks")
      .select(CHECK_DETAIL_COLUMNS)
      .in("id", checkIds);
    if (cErr) throw cErr;
    for (const c of checks ?? []) checksById.set(String(c.id), mapCheckDetail(c));
  }
  return (data ?? []).map((r) => mapEntry(r, checksById));
}

/** Mục watchlist cho 1 checkId (report button sau này). */
export async function getWatchlistItemByCheck(
  s: SupabaseClient,
  userId: string,
  checkId: string,
): Promise<WatchlistEntry | null> {
  const { data, error } = await s
    .from("watchlist_items")
    .select("*")
    .eq("user_id", userId)
    .eq("check_id", checkId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapEntry(data, await loadCheckDetail(s, checkId));
}

/** Verify tin thuộc user qua session (RLS) trước khi cho lưu. */
export async function assertCheckOwned(
  s: SupabaseClient,
  userId: string,
  checkId: string,
): Promise<boolean> {
  const { data, error } = await s
    .from("checks")
    .select("id")
    .eq("id", checkId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** Verify radar thuộc user qua session (RLS). */
export async function getOwnedRadar(
  s: SupabaseClient,
  userId: string,
  radarId: string,
): Promise<boolean> {
  const { data, error } = await s
    .from("radars")
    .select("id")
    .eq("id", radarId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** External id phải nằm trong radar_matches của radar đó (session/RLS). */
export async function externalIdInRadar(
  s: SupabaseClient,
  radarId: string,
  externalId: string,
): Promise<boolean> {
  const { data, error } = await s
    .from("radar_matches")
    .select("external_id")
    .eq("radar_id", radarId)
    .eq("external_id", externalId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export interface RadarListingSnapshot {
  marketListingId: string;
  listingTitle: string | null;
  listingUrl: string | null;
  listingPriceVnd: number | null;
  listingSizeM2: number | null;
  listingAreaName: string | null;
  listingRegionName: string | null;
}

/** Resolve market_listing_id + snapshot qua admin client (độc quyền truy cập
 *  market_listings). KHÔNG dùng admin để qua ownership: đã verify ở trên. */
export async function resolveMarketListingByExternalId(
  admin: SupabaseClient,
  externalId: string,
): Promise<RadarListingSnapshot | null> {
  const { data, error } = await admin
    .from("market_listings")
    .select("id, title, url, price_vnd, size_m2, area_name, region_name")
    .eq("external_id", externalId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    marketListingId: String(data.id),
    listingTitle: str(data.title),
    listingUrl: str(data.url),
    listingPriceVnd: num(data.price_vnd),
    listingSizeM2: num(data.size_m2),
    listingAreaName: str(data.area_name),
    listingRegionName: str(data.region_name),
  };
}

/** Bản insert row thô cho anchor check. */
export async function insertCheckWatchlistItem(
  s: SupabaseClient,
  userId: string,
  args: { checkId: string; status: WatchlistStatus; note: string | null },
) {
  const { data, error } = await s
    .from("watchlist_items")
    .insert({
      user_id: userId,
      check_id: args.checkId,
      market_listing_id: null,
      status: args.status,
      note: args.note,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") return { duplicate: true as const };
    throw error;
  }
  return { row: data as Row };
}

export async function insertListingWatchlistItem(
  s: SupabaseClient,
  userId: string,
  args: {
    marketListingId: string;
    status: WatchlistStatus;
    note: string | null;
    snapshot: RadarListingSnapshot;
  },
) {
  const { data, error } = await s
    .from("watchlist_items")
    .insert({
      user_id: userId,
      check_id: null,
      market_listing_id: args.marketListingId,
      listing_title: args.snapshot.listingTitle,
      listing_url: args.snapshot.listingUrl,
      listing_price_vnd: args.snapshot.listingPriceVnd,
      listing_size_m2: args.snapshot.listingSizeM2,
      listing_area_name: args.snapshot.listingAreaName,
      listing_region_name: args.snapshot.listingRegionName,
      status: args.status,
      note: args.note,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") return { duplicate: true as const };
    throw error;
  }
  return { row: data as Row };
}

/** Lấy item đang tồn tại sau khi trùng anchor (idempotent). */
export async function getWatchlistByAnchor(
  s: SupabaseClient,
  userId: string,
  anchor: { checkId?: string; marketListingId?: string },
): Promise<WatchlistEntry | null> {
  let q = s.from("watchlist_items").select("*").eq("user_id", userId);
  if (anchor.checkId) q = q.eq("check_id", anchor.checkId);
  else if (anchor.marketListingId) q = q.eq("market_listing_id", anchor.marketListingId);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // Anchor check phải trả ĐỦ check detail (title/score/seoSlug/price/isNgoP…),
  // không chỉ row watchlist — nếu không, POST trùng anchor mất dữ liệu tin.
  const checkId = str(data.check_id);
  return mapEntry(data, checkId ? await loadCheckDetail(s, checkId) : new Map());
}

export async function patchWatchlistItem(
  s: SupabaseClient,
  userId: string,
  id: string,
  patch: { status?: WatchlistStatus; note?: string | null },
): Promise<WatchlistEntry | null> {
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.note !== undefined) update.note = patch.note;

  const { data, error } = await s
    .from("watchlist_items")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // Cùng shape với POST/GET: item anchor check phải kèm check detail.
  const checkId = str(data.check_id);
  return mapEntry(data, checkId ? await loadCheckDetail(s, checkId) : new Map());
}

export async function deleteWatchlistItem(
  s: SupabaseClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const { data, error } = await s
    .from("watchlist_items")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}
