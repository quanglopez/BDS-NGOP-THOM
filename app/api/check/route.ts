import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { planLimit, vnDayStartISO, effectivePlan } from "@/lib/quota";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { detectProvince, provinceLabel } from "@/lib/provinces";
import { extractPhone } from "@/lib/phone";
import { extractBedrooms } from "@/lib/bedrooms";
import { resolveAreaM2 } from "@/lib/area";
import { analyzeListing, fromApiResponse, SCORING_CODE_VERSION } from "@/lib/scoring";
import { CHECK_QUESTIONS, callJev, investmentScore100, type JevAnswer } from "@/lib/ai/jev-check";
import { buildScoringSnapshot } from "@/lib/score-snapshot";
import { resolveListingGeo } from "@/lib/geo/url-parser";
import { persistCheckGeo } from "@/lib/check-geo";
import { adminClient } from "@/lib/admin";
import { safeErrorCode } from "@/lib/price/errors";
import { buildReportSlug } from "@/lib/report/slug";

// API check 1 tin BĐS qua Jev. Key chỉ nằm ở server, không bao giờ lộ ra client.
// Cần đăng nhập (session Supabase) + có quota trong ngày.
export const runtime = "nodejs";
// Jev đôi khi chậm 20-40s; Hobby cho tối đa 300s nên để 60s cho chắc
export const maxDuration = 60;

// Chỉ cho phép gọi từ site của mình (kèm localhost để dev)
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
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

// Đọc quota hôm nay của 1 user (dùng cho GET và POST)
async function getQuota(supabase: SupabaseClient, userId: string) {
  const { data: profile } = await supabase
    .from("users")
    .select("plan, credits, plan_expires_at")
    .eq("id", userId)
    .single();

  // Gói đã hết hạn = Free
  const plan = effectivePlan(profile?.plan, profile?.plan_expires_at);
  const limit = planLimit(plan);
  const { count } = await supabase
    .from("checks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", vnDayStartISO());

  const used = count ?? 0;
  const credits = profile?.credits ?? 0;
  return {
    plan,
    plan_expires_at: profile?.plan_expires_at ?? null,
    limit,
    used,
    credits,
    // Lượt còn lại = hạn ngày chưa dùng + credits thưởng
    remaining: Math.max(0, limit - used) + credits,
  };
}

// GET: quota hôm nay để Bulk Check biết còn bao nhiêu lượt
export async function GET(req: NextRequest) {
  const CORS = corsHeaders(req);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401, headers: CORS });
  }

  return NextResponse.json(await getQuota(supabase, user.id), { headers: CORS });
}

export async function POST(req: NextRequest) {
  const CORS = corsHeaders(req);
  // requestId giúp đối chiếu log server với lỗi user thấy trên UI
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();

  // Chặn flood theo IP trước khi tốn phí gọi AI
  const ip = clientIp(req);
  const rate = await checkRateLimit(ip);
  if (!rate.allowed) {
    console.warn(`[check:${requestId}] RATE_LIMIT ip=${ip}`);
    return NextResponse.json(
      { error: "Bạn gửi quá nhanh. Vui lòng thử lại sau ít phút." },
      { status: 429, headers: { ...CORS, "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const text: string = body?.text ?? "";
    // Thông tin liên hệ: client gửi kèm (từ quét danh mục) hoặc tự trích từ text tin
    const contactName: string | null = body?.contactName ? String(body.contactName).slice(0, 80) : null;
    const listingUrl: string | null = body?.listingUrl ? String(body.listingUrl).slice(0, 300) : null;
    const contactPhone: string | null = body?.phone
      ? String(body.phone).replace(/\D/g, "").slice(0, 11) || null
      : extractPhone(text);

    // Địa lý cho nhóm tham chiệu giá.
    // CHỈ lấy từ category scan scope (ward + region). KHÔNG parse URL ở đây:
    // tên phường trong slug URL chỉ tách được khi đã có bảng tra từ market_listings,
    // mà bảng đó chỉ có dữ liệu sau lần crawl giá đầu tiên. Việc parse URL do
    // /api/price-intelligence lo lúc generate snapshot.
    // Không xác định được -> null, KHÔNG suy đoán.
    const geo = resolveListingGeo({
      scanWard: body?.ward ?? null,
      scanRegion: body?.region ?? null,
    });

    if (!text || text.length < 20) {
      return NextResponse.json({ error: "Tin BĐS quá ngắn" }, { status: 400, headers: CORS });
    }

    const JEV_KEY = process.env.JEV_API_KEY;
    if (!JEV_KEY) {
      console.error(`[check:${requestId}] MISSING_JEV_API_KEY - chưa cấu hình JEV_API_KEY trên Vercel`);
      return NextResponse.json(
        { error: "Chưa cấu hình JEV_API_KEY trên Vercel" },
        { status: 500, headers: CORS },
      );
    }

    // Phải đăng nhập mới dùng AI (chặn abuse + trừ quota)
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Cần đăng nhập để check" }, { status: 401, headers: CORS });
    }

    // Quota trong ngày theo gói
    const quota = await getQuota(supabase, user.id);
    const limit = quota.limit;

    let usingCredit = false;
    if (quota.used >= limit) {
      // Hết lượt ngày -> dùng credits thưởng (giới thiệu bạn +10 check)
      if (quota.credits > 0) {
        usingCredit = true;
      } else {
        return NextResponse.json(
          { error: `Hết ${limit} lượt check/ngày của gói ${quota.plan}. Nâng cấp Pro để check thêm.` },
          { status: 429, headers: CORS },
        );
      }
    }

    // Nhận diện tỉnh + giá + diện tích từ nội dung tin để chấm đúng khu vực và lưu lịch sử
    const detectedProvince = detectProvince(text);
    const priceMatch = text.match(/(\d+[\.,]?\d*)\s*tỷ/i);
    const priceBillion = priceMatch ? Number(priceMatch[1].replace(",", ".")) : null;
    // Diện tích: ưu tiên số CÓ CẤU TRÚC do /api/extract trả về (areaHint).
    // Regex cũ `/(\d+)\s*m2/` bắt nhầm số cuối của dải: "62-82,5-105,5m2" ra 5,
    // kéo area_m2 về 5 và size band xuống 3-8 m2 -> crawl không còn mẫu nào.
    const area = resolveAreaM2(text, body?.areaHint);
    const areaM2 = area.areaM2;
    const bedrooms = extractBedrooms(text);

    let jevRes: Response;
    try {
      jevRes = await callJev(
        JEV_KEY,
        {
          model: "jev-latest",
          // Chèn hint khu vực để AI chấm vị trí/tăng giá đúng tỉnh
          state: `Khu vực: ${provinceLabel(detectedProvince)}\n${text.slice(0, 5900)}`,
          questions: CHECK_QUESTIONS,
        },
        requestId,
        `ip=${ip}`,
      );
    } catch (e) {
      console.error(`[check:${requestId}] JEV_UNAVAILABLE ip=${ip}`, e);
      return NextResponse.json(
        { error: "AI đang bận, vui lòng thử lại sau ít phút." },
        { status: 503, headers: CORS },
      );
    }

    const raw = await jevRes.text();
    if (!jevRes.ok) {
      // Log chi tiết lỗi provider để debug trong Vercel Logs (không log key)
      console.error(
        `[check:${requestId}] JEV_ERROR status=${jevRes.status} url=https://api.typesafe.ai/v1/systemone body=${raw.slice(0, 800)}`,
      );
      return NextResponse.json(
        { error: "Jev lỗi", detail: raw.slice(0, 500) },
        { status: jevRes.status, headers: CORS },
      );
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error(`[check:${requestId}] JEV_BAD_JSON body=${raw.slice(0, 500)}`, e);
      return NextResponse.json(
        { error: "Jev trả về dữ liệu không hợp lệ" },
        { status: 502, headers: CORS },
      );
    }
    // answers: object, mỗi câu hỏi có score/noul/choice/confidence
    const ans = (data.answers ?? data) as Record<string, JevAnswer>;

    // Điểm 0-4 của score type quy về thang 100
    const invest100 = investmentScore100(ans.investment_potential?.score ?? 0) ?? 0;
    const dealType = ans.deal_type?.choice || "binh_thuong";
    const isNgop = Math.round((ans.is_ngop?.noul ?? 0) * 100);

    // Lưu lịch sử (không chặn response nếu ghi DB lỗi).
    // Lấy lại id để client mở được /bao-cao/[id] và Pro Analysis có cache key.
    //
    // Snapshot: dựng ĐÚNG AnalysisResult mà client sẽ nhận (fromApiResponse merge
    // sub-score Jev vào local) rồi chụp lại. Nhờ vậy Evidence Pack server-side
    // dùng cùng một bộ số với breakdown người dùng vừa xem — không phải hai
    // bộ khác nhau. Sub-score Jev persist riêng làm tầng 2 khi thiếu snapshot.
    const localResult = analyzeListing(text);
    const mergedResult = fromApiResponse(
      {
        investment_score: invest100,
        deal_type: dealType,
        confidence: ans.deal_type?.confidence || 0.7,
        is_ngop: isNgop,
        legal_safety: Math.round((ans.legal_safety?.noul ?? 0) * 100),
        location_growth: ans.location_growth?.score ?? 0,
        liquidity: ans.liquidity?.score ?? 0,
        province: detectedProvince,
      },
      localResult,
    );
    const scoringSnapshot = buildScoringSnapshot({ result: mergedResult, dealType });

    const { data: inserted } = await supabase
      .from("checks")
      .insert({
        user_id: user.id,
        original_text: text.slice(0, 6000),
        score: invest100,
        deal_type: dealType,
        is_ngop: isNgop,
        province: detectedProvince,
        price_billion: priceBillion,
        area_m2: areaM2,
        bedrooms,
        phone: contactPhone,
        contact_name: contactName,
        listing_url: listingUrl,
        // Tầng 1: snapshot đầy đủ tại thời điểm check
        scoring_snapshot: scoringSnapshot,
        // Version đi kèm công thức chấm điểm, không lấy từ env
        scoring_code_version: SCORING_CODE_VERSION,
        // Tầng 2: sub-score Jev thô (noul 0..1, score 0..4) để dựng lại khi thiếu snapshot
        jev_is_ngop: ans.is_ngop?.noul ?? null,
        jev_legal_safety: ans.legal_safety?.noul ?? null,
        jev_location_growth: ans.location_growth?.score ?? null,
        jev_liquidity: ans.liquidity?.score ?? null,
        jev_deal_confidence: ans.deal_type?.confidence ?? null,
      })
      .select("id")
      .single();
    const checkId: string | null = inserted?.id ?? null;

    // Ghi địa lý RIÊNG, sau khi đã có checkId. Tách khỏi insert chính để thiếu
    // cột (chưa chạy migration 0014) chỉ mất dữ liệu địa lý, không làm hỏng check.
    // Cần service role vì bảng checks không có update policy cho user.
    if (checkId) {
      try {
        const geoResult = await persistCheckGeo(adminClient(), checkId, geo);
        if (!geoResult.ok) {
          // Log chỉ check id + mã lỗi. KHÔNG log tên/giá/URL/SĐT.
          console.warn(`[check-geo-warning] check=${checkId} error_code=${geoResult.errorCode}`);
        }
      } catch (e) {
        console.warn(`[check-geo-warning] check=${checkId} error_code=${safeErrorCode(e)}`);
      }
    }

    // Slug SEO cho URL /bao-cao/{slug}. Ghi TÁCH RIÊNG, sau khi đã có id
    // (shortId cần uuid). Bọc try/catch + catch lỗi cột: nếu migration
    // 0018 chưa chạy, check vẫn tạo bình thường, chỉ mất URL SEO.
    let seoSlug: string | null = null;
    if (checkId) {
      try {
        seoSlug = buildReportSlug({
          id: checkId,
          title: text.split("\n")[0] ?? "",
          province: detectedProvince,
          price: typeof priceBillion === "number" && priceBillion > 0 ? priceBillion * 1e9 : null,
        });
        const { error: slugError } = await adminClient()
          .from("checks")
          .update({ seo_slug: seoSlug })
          .eq("id", checkId);
        if (slugError) {
          // Bất kỳ lỗi ghi nào (thiếu cột, trùng UNIQUE, hết quyền) đều
          // phải trả null: slug KHÔNG nằm trong DB thì URL đó sẽ 404, và
          // nếu trùng slug mà vẫn trả thì còn mở NHẦM report người khác.
          seoSlug = null;
          // KHÔNG log nội dung tin (PII). Chỉ log id + mã lỗi.
          console.warn(`[check-slug-warning] check=${checkId} error_code=${slugError.code ?? "unknown"}`);
        }
      } catch (e) {
        seoSlug = null;
        console.warn(`[check-slug-warning] check=${checkId} error_code=${safeErrorCode(e)}`);
      }
    }

    // Nếu check bằng credits thưởng thì trừ 1
    if (usingCredit) {
      await supabase
        .from("users")
        .update({ credits: quota.credits - 1 })
        .eq("id", user.id);
      quota.credits -= 1;
    }
    quota.used += 1;
    quota.remaining = Math.max(0, limit - quota.used) + quota.credits;

    console.log(
      `[check:${requestId}] OK user=${user.id} score=${invest100} deal=${dealType} ms=${Date.now() - startedAt}`,
    );

    return NextResponse.json(
      {
        check_id: checkId,
        // Slug đã ghi vào DB. null khi ghi lỗi (thiếu cột / trùng slug) —
        // client rơi về URL UUID, vốn luôn mở được.
        seo_slug: seoSlug,
        investment_score: invest100,
        deal_type: dealType,
        confidence: ans.deal_type?.confidence || 0.7,
        is_ngop: isNgop,
        legal_safety: Math.round((ans.legal_safety?.noul ?? 0) * 100),
        location_growth: ans.location_growth?.score ?? 0,
        liquidity: ans.liquidity?.score ?? 0,
        province: detectedProvince,
        price_billion: priceBillion,
        area_m2: areaM2,
        bedrooms,
        analyzed_at: new Date().toISOString(),
        quota,
        raw: data,
      },
      { headers: CORS },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Lỗi không xác định";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS });
  }
}
