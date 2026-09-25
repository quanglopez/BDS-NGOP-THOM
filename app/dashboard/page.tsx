import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/sign-out-button";

export const metadata: Metadata = {
  title: "Dashboard môi giới - Check BĐS Ngộp",
};

// Dashboard cho môi giới (bước 3 sẽ bổ sung lịch sử check + bulk check)
export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("users").select("name, phone, plan, credits").eq("id", user.id).single();

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
        <h1 className="text-[24px] md:text-[30px] font-black tracking-tight text-navy">
          Xin chào {profile?.name || profile?.phone || "môi giới"} 👋
        </h1>
        <p className="mt-2 text-[13px] text-slate-500">
          Gói hiện tại:{" "}
          <span className="px-2 py-1 rounded-full bg-navy text-white text-[11px] font-bold uppercase">
            {profile?.plan || "free"}
          </span>{" "}
          • Credits: <b>{profile?.credits ?? 0}</b>
        </p>

        <div className="mt-8 rounded-[18px] border border-dashed border-slate-300 bg-white p-8 text-center text-[13px] text-slate-500">
          Lịch sử check, Bulk Check và Stats cards sẽ có ở bước tiếp theo.
        </div>
      </div>
    </main>
  );
}
