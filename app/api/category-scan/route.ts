import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { effectivePlan } from "@/lib/quota";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { scanCategoryUrl } from "@/lib/chotot-category";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_ORIGINS = new Set([
  "https://checkbds.online",
  "http://checkbds.online",
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

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

// Quét 1 trang danh mục Chợ Tốt/Nhà Tốt -> danh sách tin bán để khách chọn rồi check.
// Chỉ đọc gateway public của Chợ Tốt (host cố định), không fetch HTML (bị chặn),
// trần Free 10 / Pro 50 tin một lần quét.
export async function POST(req: NextRequest) {
  const CORS = corsHeaders(req);
  const ip = clientIp(req);

  const rate = await checkRateLimit(ip, 10, "category");
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: "Bạn quét quá nhanh, thử lại sau ít phút." },
      {
        status: 429,
        headers: { ...CORS, "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) },
      },
    );
  }

  const { url } = await req.json().catch(() => ({ url: "" }));
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json(
      { ok: false, reason: "missing_url", message: "Thiếu đường dẫn danh mục." },
      { status: 400, headers: CORS },
    );
  }

  // Trần theo gói người dùng (dashboard đã đăng nhập)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let limit = 10;
  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("plan, plan_expires_at")
      .eq("id", user.id)
      .single();
    if (effectivePlan(profile?.plan, profile?.plan_expires_at) !== "free") {
      limit = 50;
    }
  }

  const result = await scanCategoryUrl(url, limit);
  if (!result.ok) {
    console.log(`[category] FAIL ${result.reason} ip=${ip} url=${url.slice(0, 120)}`);
    return NextResponse.json(
      { ok: false, reason: result.reason, message: result.message },
      { status: 422, headers: CORS },
    );
  }

  console.log(
    `[category] OK ip=${ip} ward=${result.scan.scope.ward ?? "?"} region=${result.scan.scope.region ?? "?"} total=${result.scan.scope.total} items=${result.scan.items.length}`,
  );
  return NextResponse.json({ ok: true, limit, ...result.scan }, { headers: CORS });
}
