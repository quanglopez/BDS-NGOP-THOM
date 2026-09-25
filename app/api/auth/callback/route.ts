import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { applyReferral } from "@/lib/referral";

// Callback sau khi Google OAuth trả về: đổi code lấy session, áp dụng mã giới thiệu, về /dashboard
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const ref = searchParams.get("ref");

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Giới thiệu bạn: ref trên URL -> +10 check cho người giới thiệu (không chặn login nếu lỗi)
      if (ref && data.user && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const admin = createSupabaseAdmin(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            { auth: { persistSession: false } },
          );
          await applyReferral(admin, ref, data.user.id);
        } catch {
          // bỏ qua
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
