import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PLANS, transferContent } from "@/lib/payments";

// Tạo bản ghi thanh toán pending cho gói user chọn
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  }

  const { plan } = await req.json().catch(() => ({}));
  const planKey = plan === "team" ? "team" : plan === "pro" ? "pro" : null;
  if (!planKey) {
    return NextResponse.json({ error: "Gói không hợp lệ" }, { status: 400 });
  }

  const amount = PLANS[planKey].price;
  const content = transferContent(user.id);

  // Đã có giao dịch đang chờ với đúng nội dung CK thì dùng lại, khỏi tạo trùng
  // (mỗi lần bấm "Tạo mã QR" trước đây sinh thêm 1 bản ghi pending mới)
  const { data: existing } = await supabase
    .from("payments")
    .select("id, plan, amount, transfer_content, status, created_at")
    .eq("user_id", user.id)
    .eq("transfer_content", content)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ payment: existing, content, amount });
  }

  const { data, error } = await supabase
    .from("payments")
    .insert({ user_id: user.id, plan: planKey, amount, transfer_content: content, status: "pending" })
    .select("id, plan, amount, transfer_content, status, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ payment: data, content, amount });
}
