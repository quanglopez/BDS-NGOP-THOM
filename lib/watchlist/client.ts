// Client-side helpers cho watchlist UI. Không import AI/scoring/quota —
// watchlist là cache dữ liệu người dùng thuần túy.
import type { WatchlistEntry } from "./data";
import type { WatchlistStatus } from "./types";

export type WatchlistResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      message: string;
      /** Field lỗi từ validateWatchlistCreate/Patch (anchor/status/note/patch). */
      fieldErrors?: Record<string, string>;
    };

async function readError(res: Response): Promise<Extract<WatchlistResult<never>, { ok: false }>> {
  let message = "Lỗi hệ thống";
  let fieldErrors: Record<string, string> | undefined;
  try {
    const body = (await res.json()) as { error?: string; fieldErrors?: Record<string, string> };
    if (typeof body.error === "string" && body.error) message = body.error;
    if (body.fieldErrors && typeof body.fieldErrors === "object") fieldErrors = body.fieldErrors;
  } catch {
    // Body không phải JSON -> giữ message mặc định.
  }
  return { ok: false, status: res.status, message, fieldErrors };
}

/** Lưu watchlist cho 1 check đã có (report page). */
export async function postWatchlistCheck(
  checkId: string,
  input: { status?: WatchlistStatus; note?: string | null } = {},
): Promise<WatchlistResult<{ item: WatchlistEntry }>> {
  try {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkId, ...input }),
    });
    if (!res.ok) return await readError(res);
    return { ok: true, data: (await res.json()) as { item: WatchlistEntry } };
  } catch {
    return { ok: false, status: 0, message: "Mất kết nối. Thử lại." };
  }
}

/** Lưu watchlist cho 1 tin Radar (radarId + externalId). */
export async function postWatchlistRadar(
  radarId: string,
  externalId: string,
  input: { status?: WatchlistStatus; note?: string | null } = {},
): Promise<WatchlistResult<{ item: WatchlistEntry }>> {
  try {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ radarId, externalId, ...input }),
    });
    if (!res.ok) return await readError(res);
    return { ok: true, data: (await res.json()) as { item: WatchlistEntry } };
  } catch {
    return { ok: false, status: 0, message: "Mất kết nối. Thử lại." };
  }
}

/** Cập nhật status/note (chỉ 2 field; anchor + snapshot bị backend từ chối). */
export async function patchWatchlist(
  id: string,
  patch: { status?: WatchlistStatus; note?: string | null },
): Promise<WatchlistResult<{ item: WatchlistEntry }>> {
  try {
    const res = await fetch(`/api/watchlist/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return await readError(res);
    return { ok: true, data: (await res.json()) as { item: WatchlistEntry } };
  } catch {
    return { ok: false, status: 0, message: "Mất kết nối. Thử lại." };
  }
}

export async function deleteWatchlist(id: string): Promise<WatchlistResult<true>> {
  try {
    const res = await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
    if (!res.ok) return await readError(res);
    return { ok: true, data: true };
  } catch {
    return { ok: false, status: 0, message: "Mất kết nối. Thử lại." };
  }
}

/** Định dạng ngày vi-VN không dùng toLocaleString (deterministic mọi môi trường). */
export function formatViDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}
