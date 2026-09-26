import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { effectivePlan } from "@/lib/quota";

// Trạng thái thanh toán gần nhất + gói hiện tại (client poll để biết khi nào được nâng)
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  }

  const [{ data: profile }, { data: payment }] = await Promise.all([
    supabase.from("users").select("plan, plan_expires_at").eq("id", user.id).single(),
    supabase
      .from("payments")
      .select("plan, amount, status, created_at")
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
