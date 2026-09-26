import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PLANS, quotePrice, transferContent } from "@/lib/payments";

// Tạo bản ghi thanh toán pending cho gói + thời hạn user chọn
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const planKey = body?.plan === "team" ? "team" : body?.plan === "pro" ? "pro" : null;
  if (!planKey) {
    return NextResponse.json({ error: "Gói không hợp lệ" }, { status: 400 });
  }

  // Thời hạn: 1/2/3/6/12 tháng, giá tính theo bảng giá (chiết khấu thật)
  const months = Number(body?.months) || 1;
  const quote = quotePrice(months);
  const amount = planKey === "team" ? PLANS.team.price : quote.total;
  const content = transferContent(user.id, quote.months);

  // Đã có giao dịch đang chờ với đúng nội dung CK thì dùng lại, khỏi tạo trùng
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

  return NextResponse.json({ payment: data, content, amount, months: quote.months });
}
