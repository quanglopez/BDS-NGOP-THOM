import type { SupabaseClient } from "@supabase/supabase-js";

// Mã giới thiệu = 8 ký tự đầu của user id (không cần cột riêng trong DB)
export function refCodeOf(userId: string): string {
  return userId.replace(/-/g, "").slice(0, 8);
}

// Tìm user theo mã giới thiệu
export async function findUserByRefCode(admin: SupabaseClient, code: string): Promise<string | null> {
  const wanted = code.toLowerCase().trim();

  // Ưu tiên cột ref_code (nhanh, index unique). Nếu chưa chạy migration thì fallback bên dưới.
  const byCode = await admin.from("users").select("id").eq("ref_code", wanted).limit(2);
  if (!byCode.error) {
    return byCode.data && byCode.data.length === 1 ? (byCode.data[0].id as string) : null;
  }

  const all = await admin.from("users").select("id").limit(1000);
  if (all.error) return null;
  const matches = (all.data ?? []).filter((r) => (r.id as string).replace(/-/g, "").startsWith(wanted));
  return matches.length === 1 ? (matches[0].id as string) : null;
}

// Áp dụng mã giới thiệu: người được giới thiệu gắn referred_by, người giới thiệu +10 check
export async function applyReferral(admin: SupabaseClient, code: string, newUserId: string): Promise<boolean> {
  const referrerId = await findUserByRefCode(admin, code);
  if (!referrerId || referrerId === newUserId) return false;

  // Chỉ áp dụng 1 lần cho user mới
  const { data: me } = await admin.from("users").select("referred_by").eq("id", newUserId).single();
  if (me?.referred_by) return false;

  await admin.from("users").update({ referred_by: referrerId }).eq("id", newUserId);

  // +10 check free cho người giới thiệu
  const { data: referrer } = await admin.from("users").select("credits").eq("id", referrerId).single();
  await admin
    .from("users")
    .update({ credits: (referrer?.credits ?? 0) + 10 })
    .eq("id", referrerId);

  return true;
}
