import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/admin";
import { effectivePlan, planAllowsProAnalysis } from "@/lib/quota";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { ChototGatewayAdapter } from "@/lib/price/gateway";
import { generatePriceIntelligence } from "@/lib/price/pipeline";
import { refreshAreaIndex, knownAreas, supabaseGeoAreaMap, supabaseMarketListings, supabasePriceStats } from "@/lib/price/repos";
import { createGeoResolver } from "@/lib/price/geo-resolver";
import { PRICE_INTELLIGENCE_VERSION, type PriceIntelligence } from "@/lib/price/types";
import { safeErrorCode } from "@/lib/price/errors";
import { parseListingLocation } from "@/lib/geo/url-parser";

export const runtime = "nodejs";
// Crawl tối đa 18 lần gọi gateway; cần dư cho DB + validate
export const maxDuration = 60;

const ALLOWED_ORIGINS = new Set([
  "https://www.checkbds.online",
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET = đọc snapshot, KHÔNG bao giờ gọi gateway.
// POST = tạo snapshot nếu chưa có.
async function handle(req: NextRequest, method: "GET" | "POST") {
  const CORS = corsHeaders(req);
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();

  // 1) chặn flood theo IP — trước cả khi đọc DB
  const ip = clientIp(req);
  const rate = await checkRateLimit(ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Bạn gửi quá nhanh. Vui lòng thử lại sau ít phút." },
      { status: 429, headers: { ...CORS, "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
    );
  }

  // 2) auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401, headers: CORS });
  }

  // 3) checkId
  let checkId = "";
  if (method === "GET") {
    checkId = (req.nextUrl.searchParams.get("checkId") ?? "").trim();
  } else {
    const body = await req.json().catch(() => ({}));
    checkId = typeof body?.checkId === "string" ? body.checkId.trim() : "";
  }
  if (!UUID_RE.test(checkId)) {
    return NextResponse.json({ error: "Thiếu hoặc sai checkId" }, { status: 400, headers: CORS });
  }

  // 4) đọc check (kèm snapshot nếu có)
  const { data: row } = await supabase
    .from("checks")
    .select(
      "id, user_id, original_text, score, deal_type, province, region_name, ward_name, price_billion, area_m2, bedrooms, listing_url, price_intelligence, price_intelligence_version, price_intelligence_at",
    )
    .eq("id", checkId)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "Không tìm thấy báo cáo" }, { status: 404, headers: CORS });
  }

  // 5) ownership
  if (row.user_id !== user.id) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403, headers: CORS });
  }

  // 6) plan — Free dừng ở đây, CHƯA chạm bất kỳ lần gọi gateway nào
  const { data: profile } = await supabase
    .from("users")
    .select("plan, plan_expires_at")
    .eq("id", user.id)
    .single();
  const plan = effectivePlan(profile?.plan, profile?.plan_expires_at);
  if (!planAllowsProAnalysis(plan)) {
    return NextResponse.json(
      { error: "locked", message: "Mở khóa phân tích giá tham chiếu", requiredPlan: "pro" },
      { status: 403, headers: CORS },
    );
  }

  // 7) snapshot đã có -> trả luôn, không bao giờ regenerate
  const existing = row.price_intelligence;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return NextResponse.json({ ok: true, cached: true, data: existing }, { headers: CORS });
  }

  if (method === "GET") {
    // GET chỉ đọc — chưa có thì báo, không tự crawl
    return NextResponse.json(
      { ok: false, reason: "not_generated", message: "Chưa có dữ liệu tham chiếu cho báo cáo này." },
      { status: 200, headers: CORS },
    );
  }

  // 8) POST: dựng mới.
  // MỌI lỗi ở đây đều là SOFT FAILURE: thiếu migration, schema lỗi, upsert lỗi,
  // gateway lỗi — không được phép để thành 500. Người dùng vẫn xem được phần còn lại
  // của report, chỉ mất phần tham chiếu giá.
  const priceVnd =
    typeof row.price_billion === "number" && row.price_billion > 0 ? row.price_billion * 1e9 : null;
  const areaM2 = typeof row.area_m2 === "number" && row.area_m2 > 0 ? row.area_m2 : null;
  const bedrooms = typeof row.bedrooms === "number" && row.bedrooms > 0 ? Math.floor(row.bedrooms) : null;

  const admin = adminClient();
  // Nạp bảng tra tên địa phương từ dữ liệu đã crawl để tách slug URL chính xác.
  try {
    await refreshAreaIndex(admin);
  } catch {
    /* bỏ qua: thiếu bảng tra thì scope lùi về tầng tỉnh */
  }

  // Geo chỉ dùng để DỰNG SNAPSHOT. Sau khi lưu, không update ward/region, không
  // regenerate — lịch sử phải giữ nguyên.
  // Thứ tự: ward đã lưu (từ category scan) -> nếu chưa có thì parse từ URL.
  let wardName = row.ward_name ?? null;
  let regionName = row.region_name ?? row.province ?? null;
  if (!wardName) {
    const parsed = parseListingLocation(row.listing_url ?? null, knownAreas());
    if (parsed.ward_name) wardName = parsed.ward_name;
    if (parsed.region_name && !row.region_name) regionName = parsed.region_name;
  }

  let outcome: Awaited<ReturnType<typeof generatePriceIntelligence>>;
  try {
    outcome = await generatePriceIntelligence(
      {
        id: row.id,
        originalText: row.original_text ?? "",
        province: row.province ?? null,
        regionName,
        wardName,
        priceVnd,
        areaM2,
        bedrooms,
      },
      {
        gateway: new ChototGatewayAdapter(),
        listings: supabaseMarketListings(admin),
        stats: supabasePriceStats(admin),
        // V2: gazetteer tên -> mã. Lỗi cache/gateway ở đây KHÔNG được làm hỏng
        // pipeline -> resolver tự nuốt, hỏng thì rơi tầng tỉnh như trước.
        geo: createGeoResolver({
          repo: supabaseGeoAreaMap(admin),
          gateway: new ChototGatewayAdapter(),
          onCacheError: (stage, e) => {
            console.error(
              `[geo-resolver-error] check_id=${checkId} step=${stage} ` +
                `error_code=${safeErrorCode(e)}`,
            );
          },
        }),
      },
    );
  } catch (e) {
    // Log CHỈ 5 trường: req, check_id, step, error_code, duration.
    // Không log message thô, không log title/url/phone/user data.
    console.error(
      `[price-intelligence-error] req=${requestId} check_id=${checkId} step=crawl ` +
        `error_code=${safeErrorCode(e)} duration_ms=${Date.now() - startedAt}`,
    );
    return NextResponse.json(
      {
        ok: false,
        reason: "temporary_unavailable",
        message: "Phân tích giá tham chiếu tạm thời chưa khả dụng.",
      },
      { status: 200, headers: CORS },
    );
  }

  // outcome.reason đã là câu tiếng Việt dùng được (REASON_* trong pipeline),
  // không phải mã kỹ thuật -> trả thẳng cho UI.
  if (!outcome.ok) {
    return NextResponse.json(
      { ok: false, reason: "not_enough_data", message: outcome.reason },
      { status: 200, headers: CORS },
    );
  }

  const snapshot: PriceIntelligence = outcome.snapshot;

  // 9) lưu snapshot. Lỗi lưu KHÔNG làm hỏng response — user vẫn thấy dữ liệu,
  //    chỉ mất cache. (Đúng bài học từ Pro Analysis.)
  let saved = false;
  try {
    const { error: saveError } = await admin
      .from("checks")
      .update({
        price_intelligence: snapshot,
        price_intelligence_version: PRICE_INTELLIGENCE_VERSION,
        price_intelligence_at: new Date().toISOString(),
      })
      .eq("id", checkId);
    if (saveError) {
      // CHỈ error code, không message thô
      console.error(
        `[price-intelligence-error] req=${requestId} check_id=${checkId} step=save ` +
          `error_code=${safeErrorCode(saveError)} duration_ms=${Date.now() - startedAt}`,
      );
    } else {
      saved = true;
    }
  } catch (e) {
    console.error(
      `[price-intelligence-error] req=${requestId} check_id=${checkId} step=save ` +
        `error_code=${safeErrorCode(e)} duration_ms=${Date.now() - startedAt}`,
    );
  }

  // Log KHÔNG PII: không title, không URL, không phone, không contact
  console.log(
    `[price-intelligence] req=${requestId} check=${checkId} scope=${snapshot.scope_level} ` +
      `sample=${snapshot.sample_size} trimmed=${snapshot.trimmed_size} ` +
      `conf=${snapshot.confidence} calls=- ms=${Date.now() - startedAt} saved=${saved}`,
  );

  return NextResponse.json({ ok: true, cached: false, data: snapshot }, { headers: CORS });
}

export async function GET(req: NextRequest) {
  return handle(req, "GET");
}

export async function POST(req: NextRequest) {
  return handle(req, "POST");
}
