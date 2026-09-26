import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/site-url";

// Đăng xuất: xoá session rồi về trang chủ
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const origin = siteOrigin(new URL(request.url).origin);
  return NextResponse.redirect(`${origin}/`, { status: 302 });
}
