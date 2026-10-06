// Handler của POST /api/check, tách khỏi route file để test inject được
// dependency (Supabase client / rate limit / Jev / admin client) — không cần
// module mocking (harness `node --experimental-strip-types` không hỗ trợ).
// Logic bên trong GIỮ NGUYÊN như route cũ; chỉ thay call-site thành `deps.*`.
// File này KHÔNG import @/lib/supabase/server (kéo next/headers) để test
// import trực tiếp được.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planLimit, vnDayStartISO, effectivePlan } from "@/lib/quota";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { detectProvince, provinceLabel } from "@/lib/provinces";
import { extractPhone } from "@/lib/phone";
import { extractBedrooms } from "@/lib/bedrooms";
import { resolveAreaM2 } from "@/lib/area";
import { analyzeListing, fromApiResponse, SCORING_CODE_VERSION } from "@/lib/scoring";
import { callJev, checkInvestmentVerdict, finiteOrNull, ngopPercent, normalizeDealType, noulPercent, safeHeader, score0to4ToHundred } from "@/lib/ai/jev-check";
import { canonicalJevRequest, scoringCacheKey } from "@/lib/scoring-cache";
import type { JevAnswer } from "@/lib/ai/jev-check";
import { buildScoringSnapshot } from "@/lib/score-snapshot";
import { resolveListingGeo } from "@/lib/geo/url-parser";
import { persistCheckGeo } from "@/lib/check-geo";
import { safeErrorCode } from "@/lib/price/errors";
import { buildReportSlug } from "@/lib/report/slug";

/** Seam để test bơm Supabase/Jev giả. Không có phần tử nào là "mặc định" —
 *  route file mới tự dựng deps thật. */
export interface CheckDeps {
  createSupabaseClient: () => Promise<SupabaseClient>;
  rateLimit: typeof checkRateLimit;
  callJev: typeof callJev;
  adminClient: () => SupabaseClient;
}

// Chỉ cho phép gọi từ site của mình (kèm localhost để dev)
const ALLOWED_ORIGINS = new Set([
  "https://checkbds.online",
  "http://checkbds.online",
  "https://check-bds-ngop.vercel.app",
  "https://check-bds-ngop-quangs-projects-cc2709cd.vercel.app",
  "http://localhost:3000",
]);

export function corsHeaders(req: Request): Record<string, string> {
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
export async function getQuota(supabase: SupabaseClient, userId: string) {
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


/** Thân POST /api/check. `deps` bắt buộc để route file chỉ còn nhiệm vụ wiring. */
export async function handleCheck(req: NextRequest, deps: CheckDeps): Promise<NextResponse> {
  const CORS = corsHeaders(req);
  // requestId giúp đối chiếu log server với lỗi user thấy trên UI
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();

  // Chặn flood theo IP trước khi tốn phí gọi AI
  const ip = clientIp(req);
  const rate = await deps.rateLimit(ip);
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
    const supabase = await deps.createSupabaseClient();
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
    // --- Score cache read-through ------------------------------------------
    // Key = SHA-256(JSON canonical Jev request + SCORING_CODE_VERSION).
    // Cùng tin + cùng version code chấm = reuse score đã có, KHÔNG gọi
    // Jev lần hai. Scope theo user_id để không rò report/PII giữa account.
    // Hit: reuse score, KHÔNG gọi Jev — nhưng vẫn tạo 1 history row
    // (key NULL) nên vẫn tính 1 lượt quota/credit như check thường.
    const jevState = `Khu vực: ${provinceLabel(detectedProvince)}\n${text.slice(0, 5900)}`;
    const canonical = canonicalJevRequest(jevState);
    const cacheKey = await scoringCacheKey(jevState);

    const lookupCacheRow = async (): Promise<Record<string, unknown> | null> => {
      try {
        const { data, error } = await supabase
          .from("checks")
          .select("id, seo_slug, score, deal_type, is_ngop, province, price_billion, area_m2, bedrooms, created_at, jev_deal_confidence, jev_is_ngop, jev_legal_safety, jev_location_growth, jev_liquidity, scoring_snapshot, scoring_code_version, original_text, phone, contact_name, listing_url, provider_model_id")
          .eq("user_id", user.id)
          .eq("scoring_cache_key", cacheKey)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) {
          console.warn(`[check:${requestId}] CACHE_LOOKUP_ERROR code=${error.code ?? "unknown"}`);
          return null;
        }
        return (data as Record<string, unknown> | null) ?? null;
      } catch {
        // Cache lỗi KHÔNG được làm hỏng check — fail-open sang Jev.
        return null;
      }
    };

    // Geo + slug + trừ credit + quota counter dùng chung cho MISS và HIT:
    // mỗi lần check thành công (dù hit cache) phải có 1 history row = 1 lượt.
    const persistExtrasAndMeter = async (checkId: string): Promise<string | null> => {
      try {
        const geoResult = await persistCheckGeo(deps.adminClient(), checkId, geo);
        if (!geoResult.ok) {
          console.warn(`[check-geo-warning] check=${checkId} error_code=${geoResult.errorCode}`);
        }
      } catch (e) {
        console.warn(`[check-geo-warning] check=${checkId} error_code=${safeErrorCode(e)}`);
      }
      let seoSlug: string | null = null;
      try {
        seoSlug = buildReportSlug({
          id: checkId,
          title: text.split("\n")[0] ?? "",
          province: detectedProvince,
          price: typeof priceBillion === "number" && priceBillion > 0 ? priceBillion * 1e9 : null,
        });
        const { error: slugError } = await deps.adminClient()
          .from("checks")
          .update({ seo_slug: seoSlug })
          .eq("id", checkId);
        if (slugError) {
          seoSlug = null;
          console.warn(`[check-slug-warning] check=${checkId} error_code=${slugError.code ?? "unknown"}`);
        }
      } catch (e) {
        seoSlug = null;
        console.warn(`[check-slug-warning] check=${checkId} error_code=${safeErrorCode(e)}`);
      }
      if (usingCredit) {
        await supabase
          .from("users")
          .update({ credits: quota.credits - 1 })
          .eq("id", user.id);
        quota.credits -= 1;
      }
      quota.used += 1;
      quota.remaining = Math.max(0, limit - quota.used) + quota.credits;
      return seoSlug;
    };

    // HIT: reuse scoring result, KHÔNG gọi Jev, nhưng vẫn chèn 1 history
    // row (scoring_cache_key = NULL → không phá partial unique index,
    // không tạo cache entry mới) + trừ credit/quota y nhu MISS.
    const historyRowFromCache = (row: Record<string, unknown>) => ({
      user_id: user.id,
      original_text: (row.original_text as string | null) ?? text.slice(0, 6000),
      score: row.score,
      deal_type: row.deal_type ?? null,
      is_ngop: row.is_ngop ?? null,
      province: row.province ?? detectedProvince,
      price_billion: row.price_billion ?? priceBillion,
      area_m2: row.area_m2 ?? areaM2,
      bedrooms: row.bedrooms ?? bedrooms,
      phone: row.phone ?? contactPhone,
      contact_name: row.contact_name ?? contactName,
      listing_url: row.listing_url ?? listingUrl,
      scoring_snapshot: row.scoring_snapshot ?? null,
      scoring_code_version: (row.scoring_code_version as string | null) ?? SCORING_CODE_VERSION,
      jev_is_ngop: row.jev_is_ngop ?? null,
      jev_legal_safety: row.jev_legal_safety ?? null,
      jev_location_growth: row.jev_location_growth ?? null,
      jev_liquidity: row.jev_liquidity ?? null,
      jev_deal_confidence: row.jev_deal_confidence ?? null,
      scoring_cache_key: null,
      provider_model_id: (row.provider_model_id as string | null) ?? null,
    });

    const cachedHistoryResponse = async (row: Record<string, unknown>) => {
      const { data: insertedHit, error: hitError } = await supabase
        .from("checks")
        .insert(historyRowFromCache(row))
        .select("id")
        .single();
      if (hitError || !insertedHit?.id) {
        console.warn(`[check:${requestId}] CHECK_INSERT_ERROR code=${hitError?.code ?? "unknown"}`);
        return NextResponse.json(
          { error: "Không lưu được lịch sử check." },
          { status: 500, headers: CORS },
        );
      }
      const checkId = insertedHit.id as string;
      const seoSlug = await persistExtrasAndMeter(checkId);
      return NextResponse.json(
        {
          check_id: checkId,
          seo_slug: seoSlug,
          investment_score: row.score,
          deal_type: row.deal_type ?? null,
          confidence: finiteOrNull(row.jev_deal_confidence),
          is_ngop: finiteOrNull(row.is_ngop),
          legal_safety: row.jev_legal_safety == null ? null : noulPercent(row.jev_legal_safety),
          location_growth: row.jev_location_growth == null ? null : score0to4ToHundred(row.jev_location_growth),
          liquidity: row.jev_liquidity == null ? null : score0to4ToHundred(row.jev_liquidity),
          province: (row.province as string | null) ?? detectedProvince,
          price_billion: (row.price_billion as number | null) ?? priceBillion,
          area_m2: (row.area_m2 as number | null) ?? areaM2,
          bedrooms: (row.bedrooms as number | null) ?? bedrooms,
          analyzed_at: new Date().toISOString(),
          quota,
          cached: true,
          raw: null,
        },
        { headers: CORS },
      );
    };

    const cachedRow = await lookupCacheRow();
    if (cachedRow) {
      console.log(`[check:${requestId}] CACHE_HIT user=${user.id} check=${cachedRow.id} score=${cachedRow.score}`);
      return cachedHistoryResponse(cachedRow);
    }

    try {
      jevRes = await deps.callJev(JEV_KEY, canonical, requestId, `ip=${ip}`);
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

    // Điểm 0-4 của score type quy về thang 100.
    // Score hỏng (thiếu / không phải số) -> 502, KHÔNG phải 0: ghi 0 xuống checks
    // sẽ biến tin thành đã-chấm-0 trên Radar (score giả).
    const decided = checkInvestmentVerdict(ans);
    if (!decided.ok) {
      console.warn(`[check:${requestId}] JEV_BAD_SCORE type=invalid`);
      return NextResponse.json(
        { error: "Jev trả về dữ liệu không hợp lệ" },
        { status: 502, headers: CORS },
      );
    }
    const invest100 = decided.score;

    // --- Ngữ nghĩa Unknown ---------------------------------------------
    // Ba field dưới đây PHẢI phân biệt "provider không trả" với "provider trả
    // giá trị X". Quy chuẩn về 0/"binh_thuong" tạo dữ liệu giả: tin chưa ai
    // phân loại sẽ hiện "BÌNH THƯỜNG" và tin không có tín hiệu ngộp sẽ hiện
    // điểm ngộp 0 (= kết luận chắc chắn không ngộp).
    //   deal_type  -> chỉ dùng khi provider trả đúng 1 giá trị trong criteria.
    //   is_ngop    -> null khi không có noul; 0 là giá trị THẬT của provider.
    //   confidence -> null khi provider không trả; 0.7 là số bịa.
    // Cột DB (score/deal_type/is_ngop) vốn nullable nên không cần migration.
    const rawDealChoice = ans.deal_type?.choice;
    const dealType = normalizeDealType(rawDealChoice);
    if (dealType === null && typeof rawDealChoice === "string" && rawDealChoice.trim() !== "") {
      // Provider trả choice lạ (model đổi nhãn / dữ liệu cũ): persist null
      // ("chưa phân loại") nhưng giữ giá trị thô trong log — không nuốt mất
      // chứng cứ để đối chiếu khi provider đổi vocabulary.
      console.warn(`[check:${requestId}] DEAL_TYPE_UNKNOWN raw=${rawDealChoice.slice(0, 64)}`);
    }
    const isNgop = ngopPercent(ans.is_ngop?.noul);
    const dealConfidence = finiteOrNull(ans.deal_type?.confidence);

    // Sub-score Jev: giữ nguyên quy tắc quy đổi đã có, nhưng KHÔNG quy về 0 khi
    // thiếu. applyJevSubScores() đã xử lý null bằng cách giữ điểm local, nên
    // truyền null là an toàn và không đổi công thức chấm điểm.
    const legalSafety = noulPercent(ans.legal_safety?.noul);
    const locationGrowth = score0to4ToHundred(ans.location_growth?.score);
    const liquidity = score0to4ToHundred(ans.liquidity?.score);

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
        confidence: dealConfidence,
        is_ngop: isNgop,
        legal_safety: legalSafety,
        location_growth: locationGrowth,
        liquidity: liquidity,
        province: detectedProvince,
      },
      localResult,
    );
    const scoringSnapshot = buildScoringSnapshot({ result: mergedResult, dealType });

    // provider_model_id: model provider thật sự trả (body.model, fallback
    // header x-model) — audit sau này thấy Jev drift alias mà không cần log.
    const providerModelId =
      safeHeader(typeof data.model === "string" ? data.model : null) ??
      safeHeader(jevRes.headers.get("x-model")) ??
      null;
    const { data: inserted, error: insertError } = await supabase
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
        scoring_cache_key: cacheKey,
        provider_model_id: providerModelId,
      })
      .select("id")
      .single();
    if (insertError) {
      console.warn(`[check:${requestId}] CHECK_INSERT_ERROR code=${insertError.code ?? "unknown"}`);
      if (insertError.code === "23505") {
        // Request song song cùng tin vừa thắng race insert. Vẫn tạo 1
        // history-copy row (key NULL) cho request thua: 2 user actions =
        // 2 quota rows, cache source giữ 1 row duy nhất.
        const winner = await lookupCacheRow();
        if (winner) {
          console.log(`[check:${requestId}] CACHE_RACE_WINNER check=${winner.id}`);
          return cachedHistoryResponse(winner);
        }
      }
    }
    const checkId: string | null = inserted?.id ?? null;
    const seoSlug = checkId ? await persistExtrasAndMeter(checkId) : null;

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
        confidence: dealConfidence,
        is_ngop: isNgop,
        legal_safety: legalSafety,
        location_growth: locationGrowth,
        liquidity: liquidity,
        province: detectedProvince,
        price_billion: priceBillion,
        area_m2: areaM2,
        bedrooms,
        analyzed_at: new Date().toISOString(),
        quota,
        cached: false,
        raw: data,
      },
      { headers: CORS },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Lỗi không xác định";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS });
  }
}
