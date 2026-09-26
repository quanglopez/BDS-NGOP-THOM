import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieMethodsServer, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { applyReferral } from "@/lib/referral";
import { safeNextPath, siteOrigin } from "@/lib/site-url";

// Callback sau khi Google OAuth trả về: đổi code lấy session, áp dụng mã giới thiệu, về /dashboard
// Cookie session được gom lại rồi đính vào response redirect trả về —
// nếu không, browser không nhận cookie và login xong là mất.
// Redirect luôn về domain chuẩn (NEXT_PUBLIC_SITE_URL) nếu bị rớt về URL Vercel.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const ref = searchParams.get("ref");
  const origin = siteOrigin(new URL(request.url).origin);

  // Gom Set-Cookie từ exchangeCodeForSession để đính vào redirect cuối
  const pending: { name: string; value: string; options: CookieOptions }[] = [];
  const cookieMethods: CookieMethodsServer = {
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value, options }) => {
        request.cookies.set(name, value);
        pending.push({ name, value, options });
      });
    },
  };
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieMethods },
  );

  let dest = `${origin}/login?error=auth`;

  if (code) {
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
      dest = `${origin}${next}`;
    }
  }

  const response = NextResponse.redirect(dest);
  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, options);
  }
  return response;
}
