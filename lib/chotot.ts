// Đọc tin Chợ Tốt / Nhà Tốt qua gateway API public của họ.
// Trang chi tiết (vd nhatot.com/.../134384271.htm) bị Cloudflare chặn fetch HTML,
// nhưng gateway https://gateway.chotot.com/v1/public/ad-listing/{id} trả JSON đầy đủ,
// không cần trình duyệt, không tốn phí.

import { assertPublicUrl, FETCH_UA } from "@/lib/url-guard";
import { collapse, type ExtractedListing } from "@/lib/html-extract";

const GATEWAY = "https://gateway.chotot.com/v1/public/ad-listing/";
const TIMEOUT_MS = 12000;

export type ChototOutcome =
  | { ok: true; listing: ExtractedListing }
  | {
      ok: false;
      reason: "not_found" | "timeout" | "network_error" | "ssrf_blocked";
      message: string;
    };

// Tách ID số từ link tin chi tiết (đuôi /<id>.htm). Không phải link tin -> null.
export function parseChototId(raw: string): string | null {
  let host: string;
  let path: string;
  try {
    const u = new URL(raw.trim());
    host = u.hostname.toLowerCase();
    path = u.pathname;
  } catch {
    return null;
  }
  if (!/(^|\.)(nhatot\.com|chotot\.com)$/.test(host)) return null;
  const m = path.match(/\/(\d{5,15})\.htm$/);
  return m ? m[1] : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Ghép JSON tin thành nội dung chấm điểm (giống shape ExtractedListing)
export function adToListing(ad: Record<string, unknown>, rawUrl: string): ExtractedListing | null {
  const subject = str(ad.subject);
  const body = str(ad.body);
  if (!subject && !body) return null;

  const priceStr = str(ad.price_string);
  const size = num(ad.size);
  const addr = [str(ad.street_number), str(ad.street_name), str(ad.ward_name), str(ad.area_name), str(ad.region_name)]
    .filter(Boolean)
    .join(", ");
  const rooms = num(ad.rooms);
  const floors = num(ad.floors);

  const parts = [subject, body];
  if (priceStr) parts.push(`Giá: ${priceStr}`);
  if (size !== null) parts.push(`Diện tích: ${size} m²`);
  if (addr) parts.push(`Địa chỉ: ${addr}`);
  if (rooms !== null) parts.push(`Số phòng ngủ: ${rooms}`);
  if (floors !== null) parts.push(`Số tầng: ${floors}`);

  let domain = "";
  try {
    domain = new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    // giữ rỗng
  }

  return {
    title: subject || "Tin Chợ Tốt/Nhà Tốt",
    text: collapse(parts.join("\n")).slice(0, 6000),
    priceHint: priceStr || null,
    areaHint: size !== null ? `${size} m²` : null,
    method: "gateway",
    domain,
  };
}

export async function fetchChototListing(rawUrl: string): Promise<ChototOutcome | null> {
  const id = parseChototId(rawUrl);
  // Không phải link tin chi tiết Chợ Tốt/Nhà Tốt -> để đường fetch HTML thường xử lý
  if (!id) return null;

  // Host cố định + id chỉ gồm số -> không có nguy cơ SSRF, vẫn kiểm tra DNS cho chắc
  const checked = await assertPublicUrl(`${GATEWAY}${id}`);
  if (!checked.ok) {
    return { ok: false, reason: "ssrf_blocked", message: "Đường dẫn không được phép tải" };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(checked.url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": FETCH_UA },
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      reason: aborted ? "timeout" : "network_error",
      message: aborted ? "Chợ Tốt phản hồi quá 12 giây" : "Không kết nối được tới Chợ Tốt",
    };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) {
    return { ok: false, reason: "not_found", message: "Tin này không còn (đã bán hoặc đã xóa)" };
  }
  if (!res.ok) {
    return { ok: false, reason: "network_error", message: "Chợ Tốt đang lỗi, thử lại sau" };
  }

  const data = (await res.json().catch(() => null)) as { ad?: Record<string, unknown> } | null;
  const listing = data?.ad ? adToListing(data.ad, rawUrl) : null;
  if (!listing || listing.text.length < 120) {
    return { ok: false, reason: "not_found", message: "Không đọc được nội dung tin này" };
  }
  return { ok: true, listing };
}
