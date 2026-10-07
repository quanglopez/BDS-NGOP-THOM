import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Middleware: refresh session + chặn /dashboard khi chưa đăng nhập
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const cookieMethods: CookieMethodsServer = {
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      cookiesToSet.forEach(({ name, value, options }) =>
        response.cookies.set(name, value, options),
      );
    },
  };

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieMethods },
  );

  // Bắt buộc gọi getUser để Supabase refresh token hết hạn
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // Destination đầy đủ = pathname + query, để sau khi login quay lại ĐÚNG chỗ
  // (vd /admin?q=test). Đây chỉ là chuỗi nội bộ bắt đầu bằng "/" và luôn được
  // gắn vào query `next` -> không bao giờ trở thành host của redirect.
  const destination = path + request.nextUrl.search;

  // Chưa đăng nhập mà vào /dashboard hoặc /admin -> đá về /login
  if (!user && (path.startsWith("/dashboard") || path.startsWith("/admin"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Gán lại TOÀN BỘ query trong 1 lần: vừa xoá query gốc (nếu không, query của
    // trang được bảo vệ sẽ rò ra thành tham số top-level của /login, vd
    // ?q=test&next=... và mất khỏi destination), vừa encode `?`/`&` bên trong
    // next qua URLSearchParams. Một phép gán nên không phụ thuộc thứ tự.
    url.search = new URLSearchParams({ next: destination }).toString();
    return NextResponse.redirect(url);
  }

  // Đã đăng nhập mà vào /login -> đá về /dashboard
  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // /admin + /api/admin chỉ dành cho email trong ADMIN_EMAILS
  if (user && (path.startsWith("/admin") || path.startsWith("/api/admin"))) {
    const allowed = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (!allowed.includes((user.email ?? "").toLowerCase())) {
      if (path.startsWith("/api/")) {
        return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
      }
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
