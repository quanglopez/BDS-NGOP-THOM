import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { nextExpiry, planLimit } from "@/lib/quota";

// Danh sách email được quyền vào /admin
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

// Client service role (bypass RLS) cho các API admin
export function adminClient() {
  return createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export type AdminAction =
  | { type: "set_plan"; userId: string; plan: "free" | "pro"; months: number }
  | { type: "mark_paid"; paymentId: string; plan: "free" | "pro"; months: number };

// Các thao tác quản trị được phép (dùng chung cho page + route handler)
export async function runAdminAction(action: AdminAction) {
  const admin = adminClient();

  if (action.type === "mark_paid") {
    const { data: payment } = await admin
      .from("payments")
      .select("user_id, status")
      .eq("id", action.paymentId)
      .maybeSingle();

    if (!payment) return { error: "Không tìm thấy giao dịch" };
    if (payment.status === "paid") return { error: "Giao dịch đã được đánh dấu paid" };

    await admin
      .from("payments")
      .update({ status: "paid", sepay_ref: `manual_${Date.now()}` })
      .eq("id", action.paymentId);

    const { data: payer } = await admin
      .from("users")
      .select("plan_expires_at")
      .eq("id", payment.user_id)
      .maybeSingle();

    const expiresAt = action.months > 0 ? nextExpiry(payer?.plan_expires_at) : null;

    await admin
      .from("users")
      .update({
        plan: action.months > 0 ? action.plan : "free",
        plan_expires_at: expiresAt,
      })
      .eq("id", payment.user_id);

    return { ok: true, userId: payment.user_id, plan: action.plan, expiresAt };
  }

  // set_plan
  const { data: target } = await admin
    .from("users")
    .select("plan, plan_expires_at")
    .eq("id", action.userId)
    .maybeSingle();

  if (!target) return { error: "Không tìm thấy user" };

  const goingPro = action.plan === "pro" && action.months > 0;
  const expiresAt = goingPro ? nextExpiry(target.plan_expires_at) : null;

  await admin
    .from("users")
    .update({ plan: goingPro ? "pro" : "free", plan_expires_at: expiresAt })
    .eq("id", action.userId);

  return {
    ok: true,
    userId: action.userId,
    plan: goingPro ? "pro" : "free",
    expiresAt,
    limit: planLimit(goingPro ? "pro" : "free"),
  };
}
