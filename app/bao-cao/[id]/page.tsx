import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { effectivePlan } from "@/lib/quota";
import { dealLabel } from "@/lib/format";
import { ProReport, type ReportSeed } from "@/components/report/pro-report";
import { PriceIntelligenceSection } from "@/components/report/price-intelligence-section";

export const metadata: Metadata = {
  title: "Báo cáo phân tích - CheckBDS.online",
  robots: { index: false, follow: false },
};

function fmtVnd(v: number | null): string {
  if (v === null || v === undefined) return "Chưa rõ";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(v % 1_000_000_000 === 0 ? 0 : 2)} tỷ`;
  if (v >= 1_000_000) return `${Math.round(v / 1_000_000)} triệu`;
  return String(v);
}

// Trang báo cáo 1 lần check: auth -> ownership -> plan.
// Free thấy locked modules (không gọi AI). Pro mở toàn bộ (AI gọi 1 lần, có cache).
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/bao-cao/${id}`)}`);

  const { data: row } = await supabase
    .from("checks")
    .select(
      "id, user_id, original_text, score, deal_type, province, price_billion, area_m2, bedrooms, listing_url, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!row) notFound();
  if (row.user_id !== user.id) notFound();

  const { data: profile } = await supabase
    .from("users")
    .select("plan, plan_expires_at")
    .eq("id", user.id)
    .single();
  const plan = effectivePlan(profile?.plan, profile?.plan_expires_at);
  const isPro = plan !== "free";

  const price =
    typeof row.price_billion === "number" && row.price_billion > 0 ? row.price_billion * 1e9 : null;
  const area = typeof row.area_m2 === "number" && row.area_m2 > 0 ? row.area_m2 : null;
  const pricePerM2 = price !== null && area !== null ? Math.round(price / area) : null;
  const title = (row.original_text ?? "").split("\n")[0]?.slice(0, 200) || "Tin bất động sản";

  const seed: ReportSeed = {
    score: row.score ?? 0,
    dealType: row.deal_type ?? "binh_thuong",
    title,
    price,
    area,
    pricePerM2,
    bedrooms: typeof row.bedrooms === "number" ? row.bedrooms : null,
    ward: null,
    region: row.province,
    listingUrl: row.listing_url,
  };

  return (
    <main className="min-h-screen bg-cream">
      <div className="mx-auto max-w-[880px] px-5 md:px-8 py-8 md:py-10">
        <Link href="/dashboard" className="text-[13px] font-bold text-navy hover:underline">
          ← Về Dashboard
        </Link>

        {/* 1. Property header — render server, không chờ AI */}
        <section className="mt-4 rounded-[20px] border border-slate-200 bg-white p-5 md:p-6">
          <h1 className="text-[18px] md:text-[22px] font-black tracking-tight text-navy leading-snug">
            {title}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
            <span className="px-2.5 py-1 rounded-full bg-navy text-white font-bold">💰 {fmtVnd(price)}</span>
            <span className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 font-semibold">
              📐 {area !== null ? `${area} m²` : "Chưa rõ diện tích"}
            </span>
            {seed.bedrooms !== null && (
              <span className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 font-semibold">
                🛏 {seed.bedrooms} PN
              </span>
            )}
            {row.province && (
              <span className="px-2.5 py-1 rounded-full bg-gold text-navy font-bold">📍 {row.province}</span>
            )}
            {row.listing_url && (
              <a
                href={row.listing_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1 rounded-full bg-white border border-slate-200 font-semibold text-navy hover:underline"
              >
                Link nguồn ↗
              </a>
            )}
          </div>
        </section>

        {/* 2. CheckBDS Score — render server */}
        <section className="mt-4 rounded-[20px] bg-navy text-white p-5 md:p-6 flex items-center gap-5 relative overflow-hidden">
          <div className="absolute -top-16 right-0 w-[220px] h-[220px] bg-gold/15 rounded-full blur-[60px]" />
          <div className="w-[84px] h-[84px] shrink-0 rounded-full bg-white border-[6px] border-emerald-500 text-emerald-700 flex items-center justify-center relative">
            <div className="text-center leading-none">
              <div className="text-[26px] font-black tracking-tight">{seed.score}</div>
              <div className="text-[10px] font-bold tracking-widest mt-0.5 opacity-70">/100</div>
            </div>
          </div>
          <div className="relative">
            <div className="text-[10px] tracking-[0.18em] font-bold text-slate-400">CHECKBDS SCORE</div>
            <div className="mt-1 inline-flex px-3 py-1 rounded-full text-[12px] font-black tracking-wide bg-gold text-navy">
              {dealLabel(seed.dealType)}
            </div>
          </div>
        </section>

        {/* 3-10. AI sections (Pro) hoặc locked list (Free) — client */}
        <div className="mt-4">
          <ProReport checkId={row.id} isPro={isPro} seed={seed} />
        </div>

        {/* Phân tích giá tham chiếu — lazy, độc lập với AI, tự gọi API khi mở */}
        <div className="mt-4">
          <PriceIntelligenceSection checkId={row.id} isPro={isPro} />
        </div>
      </div>
    </main>
  );
}
