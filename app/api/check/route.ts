import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { planLimit, vnDayStartISO, effectivePlan } from "@/lib/quota";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { detectProvince, provinceLabel } from "@/lib/provinces";

// API check 1 tin BĐS qua Jev. Key chỉ nằm ở server, không bao giờ lộ ra client.
// Cần đăng nhập (session Supabase) + có quota trong ngày.
export const runtime = "nodejs";
export const maxDuration = 10;

// Chỉ cho phép gọi từ site của mình (kèm localhost để dev)
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
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

// Shape 1 câu trả lời từ Jev
type JevAnswer = {
  score?: number;
  noul?: number;
  choice?: string;
  confidence?: number;
};

// Bộ câu hỏi chấm điểm 1 tin BĐS Việt Nam
const QUESTIONS = {
  investment_potential: {
    type: "score",
    instructions: "Chấm điểm tiềm năng đầu tư BĐS Việt Nam",
    criteria: ["Rất tệ", "Thấp", "Trung bình", "Cao", "Rất cao kèo thơm"],
  },
  is_ngop: {
    type: "noul",
    instructions: "Có phải bán gấp ngộp bank thanh lý cần tiền gấp không?",
  },
  legal_safety: {
    type: "noul",
    instructions: "Pháp lý có an toàn không? sổ hồng riêng không tranh chấp?",
  },
  location_growth: {
    type: "score",
    instructions: "Vị trí tiềm năng tăng giá?",
    criteria: ["Xa trung tâm", "Trung bình", "Khá", "Tốt gần biển trung tâm", "Rất tốt mặt tiền biển Thùy Vân Trần Phú"],
  },
  liquidity: {
    type: "score",
    instructions: "Thanh khoản dễ bán lại?",
    criteria: ["Rất khó bán", "Khó", "Trung bình", "Dễ", "Rất dễ bán lại"],
  },
  deal_type: {
    type: "choice",
    instructions: "Phân loại kèo BĐS",
    criteria: {
      ngop_ngon: "Kèo ngộp ngân hàng giá rẻ hơn thị trường 15%+ - nên mua nhanh",
      thom_dau_tu: "Kèo thơm đầu tư tốt giá hợp lý vị trí đẹp",
      gia_cao: "Giá cao hơn thị trường",
      rui_ro_phap_ly: "Rủi ro pháp lý quy hoạch tranh chấp",
      binh_thuong: "Tin bình thường",
    },
  },
} as const;

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
    const areaMatch = text.match(/(\d+)\s*m2/i);
    const priceBillion = priceMatch ? Number(priceMatch[1].replace(",", ".")) : null;
    const areaM2 = areaMatch ? Number(areaMatch[1]) : null;

    const jevRes = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${JEV_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jev-latest",
        // Chèn hint khu vực để AI chấm vị trí/tăng giá đúng tỉnh
        state: `Khu vực: ${provinceLabel(detectedProvince)}\n${text.slice(0, 5900)}`,
        questions: QUESTIONS,
      }),
    });

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
    const invest = ans.investment_potential?.score ?? 0;
    const invest100 = invest <= 4 ? Math.round((invest / 4) * 100) : Math.round(invest);
    const dealType = ans.deal_type?.choice || "binh_thuong";
    const isNgop = Math.round((ans.is_ngop?.noul ?? 0) * 100);

    // Lưu lịch sử (không chặn response nếu ghi DB lỗi)
    await supabase.from("checks").insert({
      user_id: user.id,
      original_text: text.slice(0, 6000),
      score: invest100,
      deal_type: dealType,
      is_ngop: isNgop,
      province: detectedProvince,
      price_billion: priceBillion,
      area_m2: areaM2,
    });

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
