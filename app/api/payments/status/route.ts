import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { effectivePlan } from "@/lib/quota";

// Trạng thái thanh toán gần nhất + gói hiện tại (client poll để biết khi nào được nâng)
// Nếu có ?id=<paymentId> thì trả đúng payment đó thay vì payment mới nhất.
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const paymentId = searchParams.get("id");

  const [{ data: profile }, { data: payment }] = await Promise.all([
    supabase.from("users").select("plan, plan_expires_at").eq("id", user.id).single(),
    paymentId
      ? supabase
          .from("payments")
          .select("id, plan, amount, status, transfer_content, created_at")
          .eq("id", paymentId)
          .eq("user_id", user.id)
          .maybeSingle()
      : supabase
          .from("payments")
          .select("id, plan, amount, status, transfer_content, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
  ]);

  // Gói đã hết hạn thì báo free để client hiện đúng
  const plan = effectivePlan(profile?.plan, profile?.plan_expires_at);

  return NextResponse.json({
    plan,
    plan_expires_at: profile?.plan_expires_at ?? null,
    payment: payment ?? null,
  });
}
