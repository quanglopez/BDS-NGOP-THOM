// Origin chuẩn của site — dùng cho redirect sau khi đăng nhập OAuth.
// Nếu không có, Supabase có thể rớt về URL Vercel cũ và khách login xong bị đá
// sang check-bds-ngop-quangs-projects-....vercel.app/dashboard thay vì domain thật.

export function siteOrigin(reqOrigin: string): string {
  const canonical = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const host = reqOrigin.replace(/^https?:\/\//, "").toLowerCase();

  // Dev local: giữ nguyên localhost để khỏi nhảy sang production
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1") || host === "[::1]") {
    return reqOrigin;
  }

  // Rớt về *.vercel.app (Supabase chưa nhận domain mới) -> đưa về domain thật
  if (host.endsWith(".vercel.app") && canonical) return canonical;

  return canonical || reqOrigin;
}

// Chỉ nhận next là đường dẫn nội bộ, chặn open redirect (vd //evil.com)
export function safeNextPath(next: string | null): string {
  if (!next) return "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/dashboard";
  }
  return next;
}
