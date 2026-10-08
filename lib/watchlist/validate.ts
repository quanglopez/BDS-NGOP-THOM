// Validate input watchlist — thuần, không phụ thuộc Next/Supabase để test
// bằng node --experimental-strip-types (pattern lib/radar/criteria.ts).
import { isUuid } from "@/lib/report/slug";
import {
  WATCHLIST_DEFAULT_STATUS,
  WATCHLIST_NOTE_MAX,
  WATCHLIST_STATUSES,
  type WatchlistStatus,
} from "./types";

export type WatchlistFieldError = "anchor" | "status" | "note" | "patch";

export type WatchlistAnchor =
  | { kind: "check"; checkId: string }
  | { kind: "listing"; marketListingId: string };

export interface WatchlistCreateValue {
  anchor: WatchlistAnchor;
  status: WatchlistStatus;
  note: string | null;
}

export interface WatchlistCreateValidation {
  ok: boolean;
  errors: Partial<Record<WatchlistFieldError, string>>;
  value: WatchlistCreateValue | null;
}

export interface WatchlistPatchValue {
  status?: WatchlistStatus;
  note?: string | null;
}

export interface WatchlistPatchValidation {
  ok: boolean;
  errors: Partial<Record<WatchlistFieldError, string>>;
  value: WatchlistPatchValue | null;
}

function toStatus(v: unknown): WatchlistStatus | null {
  return typeof v === "string" && (WATCHLIST_STATUSES as readonly string[]).includes(v)
    ? (v as WatchlistStatus)
    : null;
}

/** Chuẩn hoá note: trim; rỗng -> null. Trả { error } khi không phải string/null hoặc quá dài. */
function toNote(v: unknown): { value: string | null; error?: string } {
  if (v === null || v === undefined) return { value: null };
  if (typeof v !== "string") return { value: null, error: "Ghi chú không hợp lệ." };
  const trimmed = v.trim();
  if (trimmed === "") return { value: null };
  if (trimmed.length > WATCHLIST_NOTE_MAX)
    return { value: null, error: `Ghi chú tối đa ${WATCHLIST_NOTE_MAX} ký tự.` };
  return { value: trimmed };
}

function toUuid(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().toLowerCase();
  return isUuid(trimmed) ? trimmed : null;
}

/** POST /api/watchlist — đúng 1 anchor (checkId XOR marketListingId). */
export function validateWatchlistCreate(input: {
  checkId?: unknown;
  marketListingId?: unknown;
  status?: unknown;
  note?: unknown;
}): WatchlistCreateValidation {
  const errors: Partial<Record<WatchlistFieldError, string>> = {};

  const checkId = toUuid(input.checkId);
  const marketListingId = toUuid(input.marketListingId);
  const hasCheck = input.checkId !== undefined && input.checkId !== null;
  const hasListing = input.marketListingId !== undefined && input.marketListingId !== null;

  let anchor: WatchlistAnchor | null = null;
  if (hasCheck === hasListing) {
    // Cả hai hoặc không cái nào.
    errors.anchor = "Chọn đúng một nguồn: tin đã check hoặc tin trên Radar.";
  } else if (hasCheck) {
    if (!checkId) errors.anchor = "Tin đã check không hợp lệ.";
    else anchor = { kind: "check", checkId };
  } else {
    if (!marketListingId) errors.anchor = "Tin trên Radar không hợp lệ.";
    else anchor = { kind: "listing", marketListingId };
  }

  // status: thiếu -> mặc định; có nhưng sai -> từ chối (không âm thầm mặc định).
  let status: WatchlistStatus = WATCHLIST_DEFAULT_STATUS;
  if (input.status !== undefined) {
    const s = toStatus(input.status);
    if (!s) errors.status = "Trạng thái không hợp lệ.";
    else status = s;
  }

  const note = toNote(input.note);
  if (note.error) errors.note = note.error;

  if (Object.keys(errors).length) return { ok: false, errors, value: null };
  return { ok: true, errors: {}, value: { anchor: anchor!, status, note: note.value } };
}

// Field anchor/snapshot bất biến — API từ chối sớm; DB chặn lần 2 (trigger + grant).

/** Trường bị cấm đổi địa chỉ anchor / snapshot / owner qua PATCH. */
const FORBIDDEN_PATCH_KEYS = new Set([
  "user_id",
  "userId",
  "check_id",
  "checkId",
  "market_listing_id",
  "marketListingId",
  "listing_title",
  "listing_url",
  "listing_price_vnd",
  "listing_size_m2",
  "listing_area_name",
  "listing_region_name",
  "id",
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
]);


/** PATCH /api/watchlist/:id — chỉ status/note; cần ít nhất 1 field. */
export function validateWatchlistPatch(input: Record<string, unknown>): WatchlistPatchValidation {
  const errors: Partial<Record<WatchlistFieldError, string>> = {};

  for (const key of Object.keys(input)) {
    if (FORBIDDEN_PATCH_KEYS.has(key)) {
      errors.patch = "Không được đổi nguồn hoặc dữ liệu tin của mục đã lưu.";
      break;
    }
  }

  const value: WatchlistPatchValue = {};

  if ("status" in input) {
    const s = toStatus(input.status);
    if (!s) errors.status = "Trạng thái không hợp lệ.";
    else value.status = s;
  }

  if ("note" in input) {
    const note = toNote(input.note);
    if (note.error) errors.note = note.error;
    else value.note = note.value;
  }

  if (!errors.patch && !("status" in input) && !("note" in input)) {
    errors.patch = "Không có thay đổi hợp lệ.";
  }

  if (Object.keys(errors).length) return { ok: false, errors, value: null };
  return { ok: true, errors: {}, value };
}
