import { NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// Nhận lead từ form dùng thử. Dùng service role vì bảng leads không mở RLS cho client.
// Endpoint public nên phải có: rate limit/IP + bẫy honeypot chống bot spam.
export async function POST(req: Request) {
  const ip = clientIp(req);

  // 10 lead/phút/IP là quá đủ cho người thật, bot bị chặn trước khi tốn insert DB
  const rate = await checkRateLimit(ip, 10, "leads");
  if (!rate.allowed) {
    console.warn(`[leads] RATE_LIMIT ip=${ip}`);
    return NextResponse.json(
      { error: "Bạn gửi quá nhanh. Vui lòng thử lại sau ít phút." },
      { status: 429 },
    );
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Chưa cấu hình SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }

  const { email, phone, planInterest, website } = await req.json().catch(() => ({}));

  // Honeypot: input ẩn "website" người thật không bao giờ điền, bot thì có.
  // Trả ok giả để bot tưởng thành công, không insert DB.
  if (typeof website === "string" && website.trim() !== "") {
    console.warn(`[leads] HONEYPOT ip=${ip}`);
    return NextResponse.json({ ok: true });
  }

  const cleanEmail = String(email ?? "").trim().toLowerCase().slice(0, 254);
  const cleanPhone = String(phone ?? "").replace(/\D/g, "").slice(0, 15);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return NextResponse.json({ error: "Email không hợp lệ" }, { status: 400 });
  }
  if (cleanPhone && (cleanPhone.length < 9 || cleanPhone.length > 15)) {
    return NextResponse.json({ error: "Số điện thoại không hợp lệ" }, { status: 400 });
  }

  const supabase = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false } },
  );

  const { error } = await supabase.from("leads").insert({
    email: cleanEmail,
    phone: cleanPhone || null,
    plan_interest: planInterest ? String(planInterest).slice(0, 20) : null,
  });

  if (error) {
    console.error(`[leads] insert error: ${error.message}`);
    return NextResponse.json({ error: "Không lưu được, thử lại sau" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
