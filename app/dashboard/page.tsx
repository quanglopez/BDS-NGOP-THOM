import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { planLimit, vnDayStartISO } from "@/lib/quota";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { HistoryTable, type CheckRow } from "@/components/dashboard/history-table";
import { BulkCheck } from "@/components/dashboard/bulk-check";
import { ReferralCard } from "@/components/dashboard/referral-card";

export const metadata: Metadata = {
  title: "Dashboard môi giới - Check BĐS Ngộp",
};

// Dashboard cho môi giới: stats + lịch sử 100 tin + Bulk Check
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: profile }, today, total, good, history] = await Promise.all([
    supabase.from("users").select("name, phone, plan, credits").eq("id", user.id).single(),
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
      .select("id, original_text, score, deal_type, is_ngop, province, price_billion, area_m2, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const plan = profile?.plan ?? "free";
  const rows = (history.data ?? []) as CheckRow[];

  return (
    <main className="min-h-screen bg-cream">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 border-b border-slate-200/60">
        <div className="mx-auto max-w-[1120px] px-5 md:px-8 h-[64px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-navy flex items-center justify-center text-gold font-black text-[14px] tracking-widest">
              AI
            </div>
            <div className="leading-none">
              <div className="font-extrabold text-[15px] tracking-tight text-navy">BĐS NGỘP THƠM</div>
              <div className="text-[11px] tracking-[0.14em] font-semibold text-slate-500 mt-[2px]">DASHBOARD</div>
            </div>
          </div>
          <SignOutButton />
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
            </p>
          </div>
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

        <BulkCheck isPro={plan !== "free"} />

        <HistoryTable rows={rows} />

        <ReferralCard />
      </div>
    </main>
  );
}
