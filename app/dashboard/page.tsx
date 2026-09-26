import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { planLimit, vnDayStartISO, effectivePlan, SCAN_LIMITS } from "@/lib/quota";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Logo } from "@/components/site/logo";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { QuickCheck } from "@/components/dashboard/quick-check";
import { HistoryTable, type CheckRow } from "@/components/dashboard/history-table";
import { BulkCheck } from "@/components/dashboard/bulk-check";
import { ReferralCard } from "@/components/dashboard/referral-card";

export const metadata: Metadata = {
  title: "Dashboard môi giới - CheckBDS.online",
};

// Dashboard cho môi giới: stats + check lẻ + quét danh mục + bulk + lịch sử
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: profile }, today, total, good, history] = await Promise.all([
    supabase.from("users").select("name, phone, plan, credits, plan_expires_at").eq("id", user.id).single(),
    supabase
      .from("checks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", vnDayStartISO()),
    supabase.from("checks").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase
      .from("checks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("score", 80),
    supabase
      .from("checks")
      .select(
        "id, original_text, score, deal_type, is_ngop, province, price_billion, area_m2, created_at, phone, contact_name, listing_url",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  // Gói đã hết hạn = Free
  const plan = effectivePlan(profile?.plan, profile?.plan_expires_at);
  const rows = (history.data ?? []) as CheckRow[];

  return (
    <main className="min-h-screen bg-cream">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-navy/90 border-b border-white/10">
        <div className="mx-auto max-w-[1120px] px-5 md:px-8 h-[64px] flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center shrink-0">
            <Logo height={24} />
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-[10px] tracking-[0.18em] font-bold text-gold">
              DASHBOARD
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1120px] px-5 md:px-8 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[24px] md:text-[30px] font-black tracking-tight text-navy">
              Xin chào {profile?.name || profile?.phone || "môi giới"} 👋
            </h1>
            <p className="mt-2 text-[13px] text-slate-500">
              Gói hiện tại:{" "}
              <span className="px-2 py-1 rounded-full bg-navy text-white text-[11px] font-bold uppercase">
                {plan}
              </span>{" "}
              • Credits: <b>{profile?.credits ?? 0}</b>
              {plan !== "free" && profile?.plan_expires_at && (
                <>
                  {" "}
                  • Hết hạn:{" "}
                  <b>{new Date(profile.plan_expires_at).toLocaleDateString("vi-VN")}</b>
                </>
              )}
            </p>
          </div>

          {/* Gói Free: nhắc nâng cấp để mở Bulk Check 100 tin + quét danh mục */}
          {plan === "free" && (
            <div className="rounded-[16px] border border-gold/40 bg-white px-4 py-3 flex items-center gap-4 shadow-sm">
              <div className="text-[12px] leading-snug">
                <div className="font-black text-navy">Nâng cấp Pro — 299k/tháng</div>
                <div className="text-slate-500">
                  500 tin/ngày • quét {SCAN_LIMITS.pro} tin/lần • Bulk Check 100 tin • xuất Excel
                </div>
              </div>
              <Link
                href="/pricing#thanh-toan"
                className="h-10 px-4 rounded-[10px] bg-gradient-to-r from-[#C9A86A] to-[#d8ba7f] text-navy text-[13px] font-bold flex items-center whitespace-nowrap hover:from-[#d8ba7f] hover:to-[#e3ca92] transition"
              >
                Nâng cấp ngay →
              </Link>
            </div>
          )}
        </div>

        <div className="mt-6">
          <StatsCards
            stats={{
              total: total.count ?? 0,
              goodDeals: good.count ?? 0,
              todayUsed: today.count ?? 0,
              todayLimit: planLimit(plan),
            }}
          />
        </div>

        <QuickCheck />

        <BulkCheck isPro={plan !== "free"} />

        <HistoryTable rows={rows} />

        <ReferralCard />
      </div>
    </main>
  );
}
