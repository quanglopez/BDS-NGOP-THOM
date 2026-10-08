// Handlers /api/watchlist tách khỏi route file để test inject deps giả
// (pattern lib/check-route.ts). Route file chỉ còn nhiệm vụ wiring.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/report/slug";
import {
  validateWatchlistCreate,
  validateWatchlistPatch,
} from "@/lib/watchlist/validate";
import {
  assertCheckOwned,
  deleteWatchlistItem,
  externalIdInRadar,
  getOwnedRadar,
  getWatchlistByAnchor,
  getWatchlistItemByCheck,
  insertCheckWatchlistItem,
  insertListingWatchlistItem,
  listWatchlist,
  patchWatchlistItem,
  resolveMarketListingByExternalId,
} from "@/lib/watchlist/data";

/** Seam để test bơm Supabase giả. Không có phần tử nào là "mặc định". */
export interface WatchlistDeps {
  createSupabaseClient: () => Promise<SupabaseClient>;
  adminClient: () => SupabaseClient;
  /** Test bơm now() cố định; prod bỏ trống -> Date.now. */
  now?: () => string;
}

type Ctx = { params: Promise<{ id: string }> };

type Authed =
  | { ok: true; s: SupabaseClient; userId: string }
  | { ok: false; status: number; body: Record<string, unknown> };

function isValidUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  return isUuid(s);
}

async function requireUser(deps: WatchlistDeps): Promise<Authed> {
  const s = await deps.createSupabaseClient();
  const {
    data: { user },
    error,
  } = await s.auth.getUser();
  // Thứ tự có ý nghĩa: shape THẬT khi anonymous là `user: null` +
  // AuthSessionMissingError ở `error` (supabase-js). Xét `error` trước sẽ
  // biến request chưa đăng nhập thành 500. Không leak raw auth error.
  if (!user) return { ok: false, status: 401, body: { error: "Cần đăng nhập" } };
  if (error) {
    console.error("[watchlist] getUser lỗi:", error.message);
    return { ok: false, status: 500, body: { error: "Lỗi xác thực" } };
  }
  return { ok: true, s, userId: user.id };
}

export function asWatchlistDeps(value: unknown): WatchlistDeps | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<WatchlistDeps>;
  if (typeof v.createSupabaseClient === "function" && typeof v.adminClient === "function") {
    return v as WatchlistDeps;
  }

  return null;
}

export async function handleGet(deps: WatchlistDeps) {
  try {
    const auth = await requireUser(deps);
    if (!auth.ok) return Response.json(auth.body, { status: auth.status });
    const items = await listWatchlist(auth.s, auth.userId);
    return Response.json({ items });
  } catch (e) {
    console.error("[watchlist] handleGet error", e);
    return Response.json({ error: "Lỗi hệ thống" }, { status: 500 });
  }
}

/** POST: checkId XOR (radarId + externalId). Idempotent theo anchor (23505 -> trả bản ghi có). */
export async function handlePost(req: Request, deps: WatchlistDeps) {
  try {
    const auth = await requireUser(deps);
    if (!auth.ok) return Response.json(auth.body, { status: auth.status });
    const { s, userId } = auth;

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Body phải là JSON" }, { status: 400 });
    }

    const hasCheckId = typeof body.checkId === "string" && body.checkId.length > 0;
    const hasRadar =
      typeof body.radarId === "string" &&
      body.radarId.length > 0 &&
      typeof body.externalId === "string" &&
      body.externalId.length > 0;

    if (hasCheckId === hasRadar) {
      return Response.json(
        { error: "Chọn đúng một nguồn: checkId hoặc radarId + externalId." },
        { status: 400 },
      );
    }

    if (hasCheckId) {
      const v = validateWatchlistCreate({
        checkId: body.checkId,
        status: body.status,
        note: body.note,
      });
      if (!v.ok) {
        return Response.json({ error: "Dữ liệu không hợp lệ", fieldErrors: v.errors }, { status: 400 });
      }
      const anchor = v.value!.anchor;
      const checkId = anchor.kind === "check" ? anchor.checkId : "";
      if (!checkId) {
        return Response.json({ error: "Anchor không hợp lệ" }, { status: 400 });
      }
      const owned = await assertCheckOwned(s, userId, checkId);
      if (!owned) return Response.json({ error: "Không tìm thấy tin" }, { status: 404 });

      const inserted = await insertCheckWatchlistItem(s, userId, {
        checkId,
        status: v.value!.status,
        note: v.value!.note,
      });
      if ("duplicate" in inserted) {
        const existing = await getWatchlistByAnchor(s, userId, { checkId });
        return Response.json({ item: existing, duplicate: true });
      }
      const newItem = await getWatchlistByAnchor(s, userId, { checkId });
      return Response.json({ item: newItem ?? { id: inserted.row.id }, duplicate: false }, { status: 201 });
    }

    // Radar branch
    if (!isValidUuid(body.radarId)) {
      return Response.json({ error: "Không tìm thấy Radar" }, { status: 404 });
    }
    const radarOwned = await getOwnedRadar(s, userId, body.radarId as string);
    if (!radarOwned) return Response.json({ error: "Không tìm thấy Radar" }, { status: 404 });

    const inRadar = await externalIdInRadar(s, body.radarId as string, body.externalId as string);
    if (!inRadar) return Response.json({ error: "Tin không thuộc Radar này" }, { status: 404 });

    const listing = await resolveMarketListingByExternalId(deps.adminClient(), body.externalId as string);
    if (!listing) {
      return Response.json({ error: "Không resolve được tin gốc" }, { status: 409 });
    }

    const v = validateWatchlistCreate({
      marketListingId: listing.marketListingId,
      status: body.status,
      note: body.note,
    });
    if (!v.ok) {
      return Response.json({ error: "Dữ liệu không hợp lệ", fieldErrors: v.errors }, { status: 400 });
    }

    const inserted = await insertListingWatchlistItem(s, userId, {
      marketListingId: listing.marketListingId,
      status: v.value!.status,
      note: v.value!.note,
      snapshot: listing,
    });
    if ("duplicate" in inserted) {
      const existing = await getWatchlistByAnchor(s, userId, {
        marketListingId: listing.marketListingId,
      });
      return Response.json({ item: existing, duplicate: true });
    }
    const newItem = await getWatchlistByAnchor(s, userId, {
      marketListingId: listing.marketListingId,
    });
    return Response.json({ item: newItem ?? { id: inserted.row.id }, duplicate: false }, { status: 201 });
  } catch (e) {
    console.error("[watchlist] handlePost error", e);
    return Response.json({ error: "Lỗi hệ thống" }, { status: 500 });
  }
}

/** PATCH: chỉ status/note; server tự set updated_at. Anchor/owner/listing_* bị từ chối ở validate. */
export async function handlePatch(ctx: Ctx, req: Request, deps: WatchlistDeps) {
  try {
    const auth = await requireUser(deps);
    if (!auth.ok) return Response.json(auth.body, { status: auth.status });
    const { s, userId } = auth;

    const { id } = await ctx.params;
    if (!isValidUuid(id)) {
      return Response.json({ error: "ID không hợp lệ" }, { status: 400 });
    }
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Body phải là JSON" }, { status: 400 });
    }

    const v = validateWatchlistPatch(body);
    if (!v.ok) {
      return Response.json({ error: "Dữ liệu không hợp lệ", fieldErrors: v.errors }, { status: 400 });
    }

    const updated = await patchWatchlistItem(s, userId, id, v.value!);
    if (!updated) return Response.json({ error: "Không tìm thấy mục đã lưu" }, { status: 404 });
    return Response.json({ item: updated });
  } catch (e) {
    console.error("[watchlist] handlePatch error", e);
    return Response.json({ error: "Lỗi hệ thống" }, { status: 500 });
  }
}

export async function handleDelete(ctx: Ctx, deps: WatchlistDeps) {
  try {
    const auth = await requireUser(deps);
    if (!auth.ok) return Response.json(auth.body, { status: auth.status });
    const { id } = await ctx.params;
    if (!isValidUuid(id)) {
      return Response.json({ error: "ID không hợp lệ" }, { status: 400 });
    }
    const deleted = await deleteWatchlistItem(auth.s, auth.userId, id);
    if (!deleted) return Response.json({ error: "Không tìm thấy mục đã lưu" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[watchlist] handleDelete error", e);
    return Response.json({ error: "Lỗi hệ thống" }, { status: 500 });
  }
}

/** GET một mục theo checkId (report dùng sau này). */
export async function handleGetByCheck(req: Request, deps: WatchlistDeps) {
  try {
    const auth = await requireUser(deps);
    if (!auth.ok) return Response.json(auth.body, { status: auth.status });
    const checkId = new URL(req.url).searchParams.get("checkId");
    if (!checkId) return Response.json({ error: "Thiếu checkId" }, { status: 400 });
    if (!isValidUuid(checkId)) {
      return Response.json({ error: "checkId không hợp lệ" }, { status: 400 });
    }
    const item = await getWatchlistItemByCheck(auth.s, auth.userId, checkId);
    return Response.json({ item });
  } catch (e) {
    console.error("[watchlist] handleGetByCheck error", e);
    return Response.json({ error: "Lỗi hệ thống" }, { status: 500 });
  }
}
