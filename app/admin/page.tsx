import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { adminClient, isAdmin } from "@/lib/admin";
import { effectivePlan, planLimit, vnDayStartISO } from "@/lib/quota";
import { AdminActions } from "@/components/admin/admin-actions";
import { countByDay, goodDealRate, hostOf, topCounts } from "@/lib/admin-stats";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Logo } from "@/components/site/logo";

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

  const weekStart = new Date(now - 7 * DAY).toISOString();
  const [leads, users, payments, usersCount, paidSum, checksToday, checksWeek, usersWeek, leadsWeek] = await Promise.all([
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
    admin
      .from("checks")
      .select("created_at, score, province, listing_url")
      .gte("created_at", weekStart)
      .order("created_at", { ascending: false })
      .limit(5000),
    admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekStart),
    admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekStart),
  ]);

  // Thống kê dùng thật 7 ngày: số check/ngày, kèo ngon, khu vực, nguồn link
  const weekRows = (checksWeek.data ?? []) as {
    created_at: string;
    score: number | null;
    province: string | null;
    listing_url: string | null;
  }[];
  const byDay = countByDay(weekRows, 7);
  const peak = Math.max(1, ...byDay.map((d) => d.count));
  const topProvince = topCounts(weekRows.map((r) => r.province), 5);
  const topSource = topCounts(weekRows.map((r) => hostOf(r.listing_url)), 5);
  const goodRate = goodDealRate(weekRows);

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
            <Logo height={24} rounded={false} />
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

        {/* Thống kê dùng thật 7 ngày */}
        <section className="mt-8 rounded-[18px] border border-slate-200 bg-white p-5">
          <h2 className="text-[16px] font-black text-navy">
            Hoạt động 7 ngày{" "}
            <span className="text-[12px] font-normal text-slate-500">
              {fmtNum(checksWeek.data?.length ?? 0)} lượt check • {fmtNum(usersWeek.count ?? 0)} user mới •{" "}
              {fmtNum(leadsWeek.count ?? 0)} lead mới • {goodRate}% kèo ngon (&gt;80 điểm)
            </span>
          </h2>

          {/* Cột số check/ngày */}
          <div className="mt-4 flex items-end gap-2 h-[96px]">
            {byDay.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.count} check`}>
                <div className="text-[11px] font-bold text-slate-500">{d.count}</div>
                <div
                  className="w-full rounded-t-[6px] bg-gradient-to-t from-navy to-[#16305f]"
                  style={{ height: `${Math.round((d.count / peak) * 56)}px`, minHeight: 2 }}
                />
                <div className="text-[10px] text-slate-400 whitespace-nowrap">{d.date.slice(5)}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <div className="text-[11px] font-black tracking-[0.14em] text-slate-500">KHU VỰC CHECK NHIỀU NHẤT</div>
              <div className="mt-2 space-y-1.5">
                {topProvince.length === 0 ? (
                  <div className="text-[12px] text-slate-400">Chưa có dữ liệu.</div>
                ) : (
                  topProvince.map((r) => (
                    <div key={r.label} className="flex items-center gap-2 text-[12px]">
                      <span className="font-semibold text-navy w-[140px] truncate">{r.label}</span>
                      <span className="h-2 rounded-full bg-gold" style={{ width: `${Math.round((r.count / topProvince[0].count) * 90)}px` }} />
                      <span className="text-slate-500">{r.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-black tracking-[0.14em] text-slate-500">NGUỒN LINK KHÁCH DÁN</div>
              <div className="mt-2 space-y-1.5">
                {topSource.length === 0 ? (
                  <div className="text-[12px] text-slate-400">Chưa có ai dán link (chỉ check text/ảnh).</div>
                ) : (
                  topSource.map((r) => (
                    <div key={r.label} className="flex items-center gap-2 text-[12px]">
                      <span className="font-semibold text-navy w-[140px] truncate">{r.label}</span>
                      <span className="h-2 rounded-full bg-gold" style={{ width: `${Math.round((r.count / topSource[0].count) * 90)}px` }} />
                      <span className="text-slate-500">{r.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

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
