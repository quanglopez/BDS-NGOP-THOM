import { NextResponse, type NextRequest } from "next/server";
import { safeFetchPage } from "@/lib/url-guard";
import { extractListing, type ExtractedListing } from "@/lib/html-extract";
import { fetchChototListing } from "@/lib/chotot";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_ORIGINS = new Set([
  "https://check-bds-ngop.vercel.app",
  "https://check-bds-ngop-quangs-projects-cc2709cd.vercel.app",
  "http://localhost:3000",
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": allowed } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

// Hướng dẫn riêng theo site khi server không đọc được (khách tự copy tay hoặc chụp ảnh)
function blockedHint(url: string, reason: string): string | null {
  if (reason !== "blocked_by_site" && reason !== "login_required") return null;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.endsWith("batdongsan.com.vn")) {
    return "Batdongsan.com.vn chặn đọc tự động. Mở tin, copy đoạn mô tả (tiêu đề, giá, diện tích, pháp lý) rồi dán vào ô — hoặc chụp màn hình tin và dùng nút Ảnh chụp tin.";
  }
  if (host.endsWith("facebook.com") || host.endsWith("fb.com") || host.endsWith("zalo.me")) {
    return "Link này cần đăng nhập nên server không đọc được. Mở tin, copy đoạn mô tả rồi dán vào ô — hoặc chụp màn hình tin và dùng nút Ảnh chụp tin.";
  }
  return null;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

// Tải nội dung tin rao từ URL để khách không phải copy tay.
// Chỉ dùng để phân tích tin người dùng đang xem: không lưu kho, không crawl hàng loạt.
export async function POST(req: NextRequest) {
  const CORS = corsHeaders(req);
  const ip = clientIp(req);

  // 30 lần/phút/IP để chặn lạm dụng
  const rate = await checkRateLimit(ip, 30, "extract");
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: "Bạn dán link quá nhanh, thử lại sau ít phút." },
      {
        status: 429,
        headers: { ...CORS, "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) },
      },
    );
  }

  const { url } = await req.json().catch(() => ({ url: "" }));
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json(
      { ok: false, reason: "missing_url", message: "Thiếu đường dẫn." },
      { status: 400, headers: CORS },
    );
  }

  const respondListing = (listing: ExtractedListing, status: number) => {
    // Không lấy được nội dung dùng để chấm điểm -> báo rõ để UI hướng dẫn copy tay
    if (listing.text.length < 120) {
      console.log(`[extract] THIN ip=${ip} domain=${listing.domain} method=${listing.method} len=${listing.text.length}`);
      return NextResponse.json(
        {
          ok: false,
          reason: "no_content",
          message: "Trang không có nội dung đọc được (có thể render bằng JavaScript). Hãy copy mô tả tin và dán vào ô.",
        },
        { status: 422, headers: CORS },
      );
    }

    console.log(`[extract] OK ip=${ip} domain=${listing.domain} method=${listing.method} len=${listing.text.length}`);
    return NextResponse.json(
      {
        ok: true,
        content_type: status === 200 ? "ok" : "partial",
        title: listing.title,
        text: listing.text,
        price_hint: listing.priceHint,
        area_hint: listing.areaHint,
        method: listing.method,
        domain: listing.domain,
      },
      { headers: CORS },
    );
  };

  // Đường nhanh: link tin Chợ Tốt/Nhà Tốt đọc qua gateway API public (không bị chặn)
  const via = await fetchChototListing(url);
  if (via) {
    if (!via.ok) {
      console.log(`[extract] FAIL ${via.reason} ip=${ip} url=${url.slice(0, 120)}`);
      return NextResponse.json({ ok: false, reason: via.reason, message: via.message }, { status: 422, headers: CORS });
    }
    return respondListing(via.listing, 200);
  }

  // Đường thường: tải HTML rồi bóc tách (thử lại 1 lần khi timeout/mạng sập)
  let fetched = await safeFetchPage(url);
  if (!fetched.ok && (fetched.reason === "timeout" || fetched.reason === "network_error")) {
    fetched = await safeFetchPage(url);
  }
  if (!fetched.ok) {
    console.log(`[extract] FAIL ${fetched.reason} ip=${ip} url=${url.slice(0, 120)}`);
    const hint = blockedHint(url, fetched.reason);
    return NextResponse.json(
      { ok: false, reason: fetched.reason, message: hint ?? fetched.message },
      { status: 422, headers: CORS },
    );
  }

  const listing = extractListing(fetched.html, url);
  return respondListing(listing, fetched.status);
}
