import { lookup } from "node:dns/promises";
import net from "node:net";

// Chặn SSRF: chỉ cho tải trang công khai qua http/https cổng 80/443.
const ALLOWED_PORTS = new Set(["80", "443"]);
const MAX_REDIRECTS = 3;
const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const TIMEOUT_MS = 8000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

export type BlockReason = "unsupported_scheme" | "ssrf_blocked" | "dns_blocked" | "dns_failed";

export type FetchOutcome =
  | { ok: true; status: number; html: string }
  | { ok: false; reason: "ssrf_blocked" | "blocked_by_site" | "login_required" | "not_found" | "too_large" | "timeout" | "network_error"; message: string };

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

// Các dải IP không được phép truy cập (loopback, nội bộ, metadata cloud, multicast)
function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true;
  const inRange = (base: string, bits: number) => {
    const b = ipv4ToInt(base)!;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (b & mask) >>> 0;
  };
  return (
    inRange("0.0.0.0", 8) || // this network
    inRange("10.0.0.0", 8) || // private
    inRange("100.64.0.0", 10) || // CGNAT
    inRange("127.0.0.0", 8) || // loopback
    inRange("169.254.0.0", 16) || // link-local + cloud metadata
    inRange("172.16.0.0", 12) || // private
    inRange("192.0.0.0", 24) ||
    inRange("192.0.2.0", 24) ||
    inRange("192.168.0.0", 16) || // private
    inRange("198.18.0.0", 15) || // benchmark
    inRange("224.0.0.0", 4) || // multicast
    inRange("240.0.0.0", 4) // reserved
  );
}

function isBlockedIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0];
  if (addr === "::1" || addr === "::") return true;
  // IPv4-mapped (::ffff:127.0.0.1) thì kiểm tra phần IPv4
  const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // unique local
  if (addr.startsWith("fe8") || addr.startsWith("fe9") || addr.startsWith("fea") || addr.startsWith("feb")) return true; // link-local
  return false;
}

function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return isBlockedIPv4(ip);
  if (v === 6) return isBlockedIPv6(ip);
  return true; // không phải IP -> coi như không an toàn
}

// Kiểm tra URL có trỏ tới IP công khai không (dùng cho cả test, không gọi mạng với IP literal)
export async function assertPublicUrl(raw: string): Promise<{ ok: true; url: URL } | { ok: false; reason: BlockReason }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "unsupported_scheme" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "unsupported_scheme" };
  }
  if (!ALLOWED_PORTS.has(url.port || "80")) {
    // port rỗng = 80/443 theo protocol
    if (url.port !== "") return { ok: false, reason: "ssrf_blocked" };
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  // IP literal -> không cần DNS
  if (net.isIP(host) !== 0) {
    if (isBlockedIp(host)) return { ok: false, reason: "ssrf_blocked" };
    return { ok: true, url };
  }

  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) {
    return { ok: false, reason: "ssrf_blocked" };
  }

  // Phân giải DNS: mọi địa chỉ trả về phải là IP công khai
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: "dns_failed" };
  }
  if (addrs.length === 0) return { ok: false, reason: "dns_failed" };
  if (addrs.some((a) => isBlockedIp(a.address))) return { ok: false, reason: "ssrf_blocked" };

  return { ok: true, url };
}

async function readCapped(res: Response): Promise<{ html: string; tooLarge: boolean }> {
  if (!res.body) return { html: "", tooLarge: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return { html: "", tooLarge: true };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { html: new TextDecoder("utf-8").decode(merged), tooLarge: false };
}

// Cloudflare / WAF trả về trang thử thách thay vì nội dung
function looksBlocked(html: string): boolean {
  return (
    /just a moment/i.test(html) ||
    /cf-browser-verification|cf_chl_opt|__cf_chl/i.test(html) ||
    /attention required!?\s*\|?\s*cloudflare/i.test(html) ||
    /enable javascript and cookies to continue/i.test(html) ||
    /đăng nhập để xem|login to continue|please log in/i.test(html)
  );
}

// Tải trang công khai, an toàn, có giới hạn
export async function safeFetchPage(rawUrl: string): Promise<FetchOutcome> {
  let target = rawUrl.trim();
  let redirects = 0;

  while (true) {
    const checked = await assertPublicUrl(target);
    if (!checked.ok) {
      const message =
        checked.reason === "unsupported_scheme"
          ? "Chỉ hỗ trợ link http/https"
          : checked.reason === "dns_failed"
            ? "Không phân giải được tên miền"
            : "Đường dẫn không được phép tải";
      return { ok: false, reason: "ssrf_blocked", message };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(checked.url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "vi,en;q=0.8",
        },
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e instanceof Error && e.name === "AbortError";
      return {
        ok: false,
        reason: aborted ? "timeout" : "network_error",
        message: aborted ? "Trang phản hồi quá 8 giây" : "Không kết nối được tới trang",
      };
    }

    // Redirect -> kiểm tra lại đích
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      clearTimeout(timer);
      if (!location) return { ok: false, reason: "network_error", message: "Trang chuyển hướng lỗi" };
      if (redirects >= MAX_REDIRECTS) {
        return { ok: false, reason: "network_error", message: "Trang chuyển hướng quá nhiều lần" };
      }
      redirects += 1;
      target = new URL(location, checked.url).toString();
      continue;
    }

    const { html, tooLarge } = await readCapped(res);
    clearTimeout(timer);

    if (tooLarge) {
      return { ok: false, reason: "too_large", message: "Trang quá lớn để đọc" };
    }
    if (res.status === 401) {
      return { ok: false, reason: "login_required", message: "Trang yêu cầu đăng nhập" };
    }
    if (res.status === 403 || res.status === 429) {
      return { ok: false, reason: "blocked_by_site", message: "Trang chặn truy cập tự động" };
    }
    if (res.status === 404) {
      return { ok: false, reason: "not_found", message: "Không tìm thấy trang" };
    }
    if (res.status >= 500) {
      return { ok: false, reason: "network_error", message: "Trang đang lỗi" };
    }
    if (looksBlocked(html)) {
      return { ok: false, reason: "blocked_by_site", message: "Trang chặn truy cập tự động" };
    }

    return { ok: true, status: res.status, html };
  }
}
