import { NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";

// Nhận lead từ form dùng thử. Dùng service role vì bảng leads không mở RLS cho client.
export async function POST(req: Request) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Chưa cấu hình SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }

  const { email, phone, planInterest } = await req.json().catch(() => ({}));

  const cleanEmail = String(email ?? "").trim().toLowerCase();
  const cleanPhone = String(phone ?? "").replace(/\D/g, "");

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
