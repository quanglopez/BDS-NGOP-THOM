import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { effectivePlan, scanLimit, SCAN_LIMITS } from "@/lib/quota";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  scanCategoryUrl,
  normalizeScanFilters,
  hasScanFilters,
  type AreaOverride,
} from "@/lib/chotot-category";

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

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const url = (body.url ?? "") as unknown;
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json(
      { ok: false, reason: "missing_url", message: "Thiếu đường dẫn danh mục." },
      { status: 400, headers: CORS },
    );
  }

  // Filter giá/diện tích/phòng ngủ (gateway chỉ lọc hộ phòng ngủ)
  const filters = normalizeScanFilters(body.filters);
  // Ghi đè khu vực: chọn tỉnh/quận khác với khu vực ghi trong link
  const rawArea = (body.areaOverride ?? {}) as Record<string, unknown>;
  const areaOverride: AreaOverride | null =
    typeof rawArea.provinceName === "string" || typeof rawArea.wardSlug === "string"
      ? {
          provinceName: typeof rawArea.provinceName === "string" ? rawArea.provinceName.trim() : null,
          wardSlug: typeof rawArea.wardSlug === "string" ? rawArea.wardSlug.trim() : null,
        }
      : null;

  // Trần theo gói người dùng (dashboard đã đăng nhập)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let limit = SCAN_LIMITS.free;
  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("plan, plan_expires_at")
      .eq("id", user.id)
      .single();
    limit = scanLimit(effectivePlan(profile?.plan, profile?.plan_expires_at));
  }

  const result = await scanCategoryUrl(url, limit, filters, areaOverride);
  if (!result.ok) {
    console.log(`[category] FAIL ${result.reason} ip=${ip} url=${url.slice(0, 120)}`);
    return NextResponse.json(
      { ok: false, reason: result.reason, message: result.message },
      { status: 422, headers: CORS },
    );
  }

  console.log(
    `[category] OK ip=${ip} ward=${result.scan.scope.ward ?? "?"} region=${result.scan.scope.region ?? "?"} total=${result.scan.scope.total} items=${result.scan.items.length} filtered=${hasScanFilters(filters)}`,
  );
  return NextResponse.json({ ok: true, limit, ...result.scan }, { headers: CORS });
}
