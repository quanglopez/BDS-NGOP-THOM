import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refCodeOf } from "@/lib/referral";

// GET: lấy mã giới thiệu + link chia sẻ của user hiện tại
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  }

  const code = refCodeOf(user.id);
  const { origin } = new URL(req.url);

  return NextResponse.json({
    code,
    link: `${origin}/login?ref=${code}`,
    bonus: "+10 check free cho mỗi người bạn giới thiệu",
  });
}
