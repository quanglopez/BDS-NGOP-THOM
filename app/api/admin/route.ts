import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, runAdminAction, type AdminAction } from "@/lib/admin";

// API admin: nâng/hạ gói thủ công, đánh dấu giao dịch đã thu tiền
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  if (!isAdmin(user.email)) return NextResponse.json({ error: "Không có quyền" }, { status: 403 });

  const action = (await req.json().catch(() => null)) as AdminAction | null;
  if (!action) return NextResponse.json({ error: "Thiếu thao tác" }, { status: 400 });

  const result = await runAdminAction(action);
  if ("error" in result) return NextResponse.json(result, { status: 400 });

  return NextResponse.json(result);
}
