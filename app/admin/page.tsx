import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { adminClient, isAdmin } from "@/lib/admin";
import { effectivePlan, planLimit, vnDayStartISO } from "@/lib/quota";
import { AdminActions } from "@/components/admin/admin-actions";
import { SignOutButton } from "@/components/auth/sign-out-button";

export const metadata: Metadata = {
  title: "Admin - Check BĐS Ngộp",
  robots: { index: false, follow: false },
};

const DAY = 86400000;

function fmtDate(v: string | null | undefined) {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("vi-VN");
}

function fmtNum(v: number | null | undefined) {
  if (v == null) return "0";
  return v.toLocaleString("vi-VN");
}

// Trang quản trị: leads + user + doanh thu + thao tác nâng/hạ gói
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: query } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdmin(user.email)) redirect("/dashboard");

  const admin = adminClient();
  const q = (query ?? "").trim();
  const now = Date.now();
  const monthStart = new Date(now - 30 * DAY).toISOString();

  const [leads, users, payments, usersCount, paidSum, checksToday] = await Promise.all([
    admin.from("leads").select("*").order("created_at", { ascending: false }).limit(100),
    admin
      .from("users")
      .select("id, name, phone, plan, credits, plan_expires_at, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("payments")
      .select("id, user_id, plan, amount, transfer_content, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    admin.from("users").select("id", { count: "exact", head: true }),
    admin
      .from("payments")
      .select("amount")
      .eq("status", "paid")
      .gte("created_at", monthStart),
    admin
      .from("checks")
      .select("id", { count: "exact", head: true })
      .gte("created_at", vnDayStartISO()),
  ]);

  const revenue = (paidSum.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const allUsers = users.data ?? [];
  const proNow = allUsers.filter(
    (u) => effectivePlan(u.plan, u.plan_expires_at) === "pro",
  ).length;

  const filtered = q
    ? allUsers.filter((u) =>
        [u.name, u.phone, u.id].some((v) => (v ?? "").toLowerCase().includes(q.toLowerCase())),
      )
    : allUsers;

  const leadRows = leads.data ?? [];
  const paymentRows = payments.data ?? [];

  return (
    <main className="min-h-screen bg-cream">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1120px] px-5 md:px-8 h-[64px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-navy flex items-center justify-center text-gold font-black text-[14px]">
              AD
            </div>
            <div className="leading-none">
              <div className="font-extrabold text-[15px] text-navy">QUẢN TRỊ</div>
              <div className="text-[11px] text-slate-500 mt-[2px]">{user.email}</div>
            </div>
          </div>
          <SignOutButton />
        </div>
      </header>

      <div className="mx-auto max-w-[1120px] px-5 md:px-8 py-8">
        {/* Số liệu tổng quan */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Tổng user", value: fmtNum(usersCount.count ?? 0) },
            { label: "Đang dùng Pro", value: fmtNum(proNow) },
            { label: "Check hôm nay", value: fmtNum(checksToday.count ?? 0) },
            { label: "Doanh thu 30 ngày", value: `${fmtNum(revenue)}đ` },
          ].map((s) => (
            <div key={s.label} className="rounded-[16px] bg-navy text-white p-4">
              <div className="text-[11px] font-bold tracking-wide opacity-80">{s.label}</div>
              <div className="mt-1 text-[22px] font-black">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Leads */}
        <section className="mt-8">
          <h2 className="text-[18px] font-black text-navy">
            Leads ({leadRows.length}) <span className="text-[12px] font-normal text-slate-500">100 gần nhất</span>
          </h2>
          <div className="mt-3 overflow-hidden rounded-[18px] border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-cream border-b border-slate-200 text-[11px] tracking-widest font-bold text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">EMAIL</th>
                    <th className="px-4 py-2.5">SĐT</th>
                    <th className="px-4 py-2.5">QUAN TÂM</th>
                    <th className="px-4 py-2.5">THỜI GIAN</th>
                  </tr>
                </thead>
                <tbody>
                  {leadRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                        Chưa có lead nào.
                      </td>
                    </tr>
                  ) : (
                    leadRows.map((l) => (
                      <tr key={l.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-2.5">{l.email}</td>
                        <td className="px-4 py-2.5 font-mono">{l.phone || "-"}</td>
                        <td className="px-4 py-2.5">{l.plan_interest || "-"}</td>
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                          {fmtDate(l.created_at)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Users + thao tác */}
        <section className="mt-8">
          <h2 className="text-[18px] font-black text-navy">
            Users ({filtered.length}) <span className="text-[12px] font-normal text-slate-500">200 gần nhất</span>
          </h2>
          <form className="mt-3 flex gap-2" action="/admin" method="get">
            <input
              name="q"
              defaultValue={q}
              placeholder="Tìm theo tên / SĐT / id..."
              className="h-10 flex-1 rounded-[10px] border border-slate-200 px-3 text-[13px]"
            />
            <button className="h-10 px-4 rounded-[10px] bg-navy text-white text-[13px] font-bold">Tìm</button>
          </form>

          <div className="mt-3 overflow-hidden rounded-[18px] border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-cream border-b border-slate-200 text-[11px] tracking-widest font-bold text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">TÊN</th>
                    <th className="px-4 py-2.5">GÓI</th>
                    <th className="px-4 py-2.5">HẠN</th>
                    <th className="px-4 py-2.5">LƯỢT/NGÀY</th>
                    <th className="px-4 py-2.5">THAO TÁC</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => {
                    const eff = effectivePlan(u.plan, u.plan_expires_at);
                    return (
                      <tr key={u.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-navy">{u.name || "(chưa có tên)"}</div>
                          <div className="text-[11px] text-slate-500 font-mono">{u.phone || u.id.slice(0, 8)}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`px-2 py-1 rounded-full text-[11px] font-bold ${
                              eff === "pro" ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"
                            }`}
                          >
                            {eff.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                          {eff === "pro" ? fmtDate(u.plan_expires_at) : "-"}
                        </td>
                        <td className="px-4 py-2.5 font-mono">{planLimit(eff)}</td>
                        <td className="px-4 py-2.5">
                          <AdminActions userId={u.id} isPro={eff === "pro"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Payments */}
        <section className="mt-8">
          <h2 className="text-[18px] font-black text-navy">
            Thanh toán ({paymentRows.length}) <span className="text-[12px] font-normal text-slate-500">100 gần nhất</span>
          </h2>
          <div className="mt-3 overflow-hidden rounded-[18px] border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-cream border-b border-slate-200 text-[11px] tracking-widest font-bold text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">NỘI DUNG CK</th>
                    <th className="px-4 py-2.5">SỐ TIỀN</th>
                    <th className="px-4 py-2.5">TRẠNG THÁI</th>
                    <th className="px-4 py-2.5">THỜI GIAN</th>
                    <th className="px-4 py-2.5">THAO TÁC</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                        Chưa có giao dịch nào.
                      </td>
                    </tr>
                  ) : (
                    paymentRows.map((p) => (
                      <tr key={p.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-2.5 font-mono text-[11px]">{p.transfer_content}</td>
                        <td className="px-4 py-2.5 font-mono">{Number(p.amount).toLocaleString("vi-VN")}đ</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`px-2 py-1 rounded-full text-[11px] font-bold ${
                              p.status === "paid"
                                ? "bg-emerald-600 text-white"
                                : "bg-amber-400 text-amber-950"
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                          {fmtDate(p.created_at)}
                        </td>
                        <td className="px-4 py-2.5">
                          {p.status === "pending" && (
                            <AdminActions paymentId={p.id} plan={p.plan === "team" ? "pro" : "pro"} />
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
