import { redirect, permanentRedirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { effectivePlan } from "@/lib/quota";
import { fmtVnd } from "@/lib/price/format";
import { formatAiGeneratedAt } from "@/lib/format";
import { parseReportRef } from "@/lib/report/slug";
import { buildReportViewModel } from "@/lib/report/view-model";
import { parseScoringSnapshot } from "@/lib/score-snapshot";
import { ProReport, type ReportSeed } from "@/components/report/pro-report";
import { PriceIntelligenceSection } from "@/components/report/price-intelligence-section";
import { getWatchlistItemByCheck } from "@/lib/watchlist/data";
import { WatchlistSaveButton } from "@/components/watchlist/save-button";
import type { WatchlistStatus } from "@/lib/watchlist/types";

export const metadata: Metadata = {
  title: "Báo cáo phân tích - CheckBDS.online",
  robots: { index: false, follow: false },
};

// Trang báo cáo 1 lần check: auth -> ownership -> plan.
// Free thấy locked modules (không gọi AI). Pro mở toàn bộ (AI gọi 1 lần, có cache).

// Dùng type cụ thể thay vì Record<string, unknown>: các truy cập field bên
// dưới (row.score, row.price_billion…) sẽ bị mất kiểu và build fail.
interface ReportRow {
  id: string;
  user_id: string;
  original_text: string | null;
  score: number | null;
  deal_type: string | null;
  is_ngop: number | null;
  province: string | null;
  price_billion: number | null;
  area_m2: number | null;
  bedrooms: number | null;
  listing_url: string | null;
  created_at: string;
  seo_slug?: string | null;
  jev_deal_confidence?: number | null;
  scoring_snapshot?: unknown;
  analysis_json?: unknown;
  ai_generated_at?: string | null;
}

// Cột numeric của Postgres trả về string qua PostgREST — ép về number.
function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Gom tín hiệu có nguồn thật từ `checks.analysis_json` đã lưu.
//
// KHÔNG suy diễn: chỉ nhặt `evidence_source` mà AI/Evidence Pack đã ghi, và
// chỉ giữ 2 nhóm có thật trong hệ thống: "listing" (nhặt từ text tin) và
// "calculated" (scoring/tính toán). Mọi nhãn free-text lạ — kể cả "missing"
// — bị loại: thiếu bằng chứng không phải bằng chứng.
// Chỉ nhận 2 nhóm có thật trong plan: nhặt từ text tin đăng (listing) và
// tính toán/scoring (calculated). `missing` không phải bằng chứng nên bỏ hẳn.
function classifyEvidenceSource(raw: unknown): "listing_text" | "calculated" | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (s === "listing_text" || s === "listing" || s.startsWith("listing")) return "listing_text";
  if (s === "calculated" || s === "deterministic_calculation" || s.startsWith("calc")) return "calculated";
  return null;
}

interface EvidenceSignalOut {
  signal: string;
  detail: string;
  source: "listing_text" | "calculated";
}

function collectEvidenceSignals(analysisJson: unknown): EvidenceSignalOut[] {
  if (typeof analysisJson !== "object" || analysisJson === null) return [];
  const a = analysisJson as Record<string, unknown>;
  const out: EvidenceSignalOut[] = [];
  const push = (title: unknown, explanation: unknown, evidenceSource: unknown): void => {
    const src = classifyEvidenceSource(evidenceSource);
    if (src === null) return;
    const label = typeof title === "string" ? title.trim() : "";
    if (!label) return;
    out.push({
      signal: label,
      detail: typeof explanation === "string" ? explanation.trim() : "",
      source: src,
    });
  };

  for (const h of Array.isArray(a.highlights) ? a.highlights : []) {
    if (h && typeof h === "object") {
      const r = h as Record<string, unknown>;
      push(r.title, r.explanation, r.evidence_source);
    }
  }
  const se2 = (a.score_explanation ?? {}) as Record<string, unknown>;
  for (const key of ["strengths", "weaknesses"] as const) {
    for (const s of Array.isArray(se2[key]) ? se2[key] : []) {
      if (s && typeof s === "object") {
        const r = s as Record<string, unknown>;
        push(r.title, r.explanation, r.evidence_source);
      }
    }
  }
  for (const f of Array.isArray(a.factor_analysis) ? a.factor_analysis : []) {
    if (f && typeof f === "object") {
      const r = f as Record<string, unknown>;
      push(r.factor, r.explanation, r.evidence_source);
    }
  }
  for (const w of Array.isArray(a.warnings) ? a.warnings : []) {
    if (w && typeof w === "object") {
      const r = w as Record<string, unknown>;
      push(r.title, r.explanation, r.evidence_source);
    }
  }
  return out;
}

const FRESHNESS_DISPLAY: Record<string, string> = {
  fresh: "Dữ liệu mới (≤ 2 ngày)",
  aging: "Dữ liệu cũ dần (2–14 ngày)",
  stale: "Dữ liệu đã cũ (> 14 ngày)",
  unknown: "Chưa có mốc thời gian",
};

// MỘT route duy nhất cho cả hai dạng URL:
//   /bao-cao/{uuid}       — URL cũ, report tạo trước migration 0018
//   /bao-cao/{seo_slug}   — URL SEO, report mới
// Không tách route: slug phải tra cứu DB mới biết, UUID thì không.
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawRef } = await params;
  const ref = parseReportRef(rawRef);
  if (!ref) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/bao-cao/${rawRef}`)}`);

  // URL cŨ (UUID) KHÔNG đọc seo_slug: nếu migration 0018 chưa chạy thì cột
  // không tồn tại, mà select cột lạ làm hỏNG MỌI report — kể cả URL UUID.
  // Nhánh slug mới cần cột đó và được bọc riêng để hỏng cục bộ.
  const BASE_COLUMNS =
    "id, user_id, original_text, score, deal_type, is_ngop, province, price_billion, area_m2, bedrooms, listing_url, created_at, jev_deal_confidence, scoring_snapshot, analysis_json, ai_generated_at";

  let row: ReportRow | null = null;
  if (ref.kind === "uuid") {
    const { data } = await supabase
      .from("checks")
      .select(BASE_COLUMNS)
      .eq("id", ref.id)
      .maybeSingle();
    row = data as ReportRow | null;
  } else {
    try {
      const { data, error } = await supabase
        .from("checks")
        .select(`${BASE_COLUMNS}, seo_slug`)
        .eq("seo_slug", ref.slug)
        .maybeSingle();
      if (error) {
        // Migration 0018 chưa chạy -> URL slug chưa dùng được, nhưng URL
        // UUID vẫn phải chạy. KHÔNG ném lỗi ra ngoài.
        console.error(`[report-slug-missing-column] error_code=${error.code ?? "unknown"}`);
        notFound();
      }
      row = data as ReportRow | null;
    } catch (e) {
      console.error(`[report-slug-lookup-failed] error_code=${e instanceof Error ? e.name : "unknown"}`);
      notFound();
    }
  }

  if (!row) notFound();
  if (row.user_id !== user.id) notFound();

  // URL cũ -> URL SEO. Đặt SAU kiểm tra ownership: redirect trước sẽ lộ
  // việc report tồn tại (và slug của nó) cho user khác.
  //
  // 308 (permanentRedirect) chứ không 307: đây là canonicalization VĨNH
  // VIỄN — slug của 1 report không bao giờ đổi, và URL slug là bản chuẩn.
  // 307 nói với crawler "tạm thời", nên URL UUID và URL slug cùng tồn tại
  // lâu dài (duplicate content). 308 gộp tín hiệu về một URL.
  // KHÔNG đụng redirect ở dòng trên (login): cái đó là 307 đúng — phụ thuộc
  // session, vào lại là quay lại URL cũ.
  const seoSlug = (row.seo_slug as string | null) ?? null;
  if (ref.kind === "uuid" && seoSlug && seoSlug.length > 0) {
    permanentRedirect(`/bao-cao/${seoSlug}`);
  }

  const { data: profile } = await supabase
    .from("users")
    .select("plan, plan_expires_at")
    .eq("id", user.id)
    .single();
  const plan = effectivePlan(profile?.plan, profile?.plan_expires_at);

  // UI KHÔNG đọc cột `checks` trực tiếp — mọi giá trị hiển thị đều đi qua
  // adapter (lib/report/view-model.ts) để null không bao giờ bị hiện thành 0
  // hay thành "BÌNH THƯỜNG". Ở đây mới có `seed` (giá/diện tích) vì 2 field đó
  // không phải kết luận AI mà là thuộc tính bất động sản, adapter không quyết.
  //
  // Evidence thật: chỉ dựng từ tín hiệu backend đã ghi (analysis_json). Nguồn
  // `missing` là thông tin về sự THIẾU, không phải bằng chứng — adapter loại và
  // UI hiện "chưa có nguồn trích dẫn".
  const evidenceSignals = collectEvidenceSignals(row.analysis_json);

  const vm = buildReportViewModel({
    check: {
      id: row.id,
      score: row.score,
      deal_type: row.deal_type,
      is_ngop: row.is_ngop,
      confidence: numOrNull(row.jev_deal_confidence),
      province: row.province,
      original_text: row.original_text,
      listing_url: row.listing_url,
      created_at: row.created_at,
      ai_generated_at: (row.ai_generated_at ?? null) as string | null,
    },
    evidenceSignals,
    plan,
  });

  const price =
    typeof row.price_billion === "number" && row.price_billion > 0 ? row.price_billion * 1e9 : null;
  const area = typeof row.area_m2 === "number" && row.area_m2 > 0 ? row.area_m2 : null;
  const pricePerM2 = price !== null && area !== null ? Math.round(price / area) : null;
  const title = (row.original_text ?? "").split("\n")[0]?.slice(0, 200) || "Tin bất động sản";

  // Delta từng yếu tố: chỉ có ở check đã lưu scoring_snapshot. Check cũ không
  // có -> null, UI không hiện con số nào thay vì suy ngược từ điểm tổng.
  const snapshot = parseScoringSnapshot(row.scoring_snapshot);

  const seed: ReportSeed = {
    score: vm.score.value,
    dealType: vm.dealType.value,
    title,
    price,
    area,
    pricePerM2,
    bedrooms: typeof row.bedrooms === "number" ? row.bedrooms : null,
    ward: null,
    region: row.province,
    listingUrl: row.listing_url,
    confidence: vm.confidence.raw,
    factorContributions: snapshot?.score_contributions ?? null,
  };

  // Entitlement quyết định quyền xem, thay vì so sánh plan tại từng component.
  const canViewPro = vm.entitlement.canViewFullReport;

  // Đã lưu Theo dõi chưa? Đọc DB của user; lỗi/table thiếu -> coi như chưa lưu
  // (nút lưu vẫn dùng được, không chặn xem report).
  let savedItem: { status: WatchlistStatus } | null = null;
  try {
    const item = await getWatchlistItemByCheck(supabase, user.id, row.id);
    if (item) savedItem = { status: item.status };
  } catch {
    savedItem = null;
  }

  return (
    <main className="min-h-screen bg-cream">
      <div className="mx-auto max-w-[880px] px-5 md:px-8 py-8 md:py-10">
        <Link href="/dashboard" className="inline-flex h-12 items-center text-[13px] font-bold text-navy hover:underline">
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
                aria-label="Mở tin đăng gốc trong tab mới"
                className="inline-flex min-h-[48px] items-center px-2.5 py-1.5 rounded-full bg-white border border-slate-200 font-semibold text-navy hover:underline"
              >
                Link nguồn ↗
              </a>
            )}
            {/* AI timestamp: chỉ hiện khi backend ghi thật mốc
                checks.ai_generated_at. null -> không render gì
                (không crash, không tự tạo mốc). */}
            {formatAiGeneratedAt(vm.aiGeneratedAt) && (
              <span
                className="inline-flex min-h-[32px] items-center px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 font-semibold text-slate-600"
                title="Mốc AI tạo phân tích cho report này"
              >
                🤖 {formatAiGeneratedAt(vm.aiGeneratedAt)}
              </span>
            )}
            {/* Freshness: chỉ hiện khi có mốc thời gian thật. "unknown" = chưa
                có dữ liệu nào để nói tuổi, KHÔNG coi là "vừa cập nhật". */}
            {vm.freshness !== "unknown" && (
              <span
                className="inline-flex min-h-[32px] items-center px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 font-semibold text-slate-600"
              >
                {FRESHNESS_DISPLAY[vm.freshness]}
              </span>
            )}
            {/* Confidence: badge từ adapter, giữ nguyên quy ước low|medium|high
                của repo. Chưa có số -> hiện "chưa đánh giá", không mặc định. */}
            <span
              className="inline-flex min-h-[32px] items-center px-2.5 py-1 rounded-full border border-slate-200 bg-white font-semibold text-slate-700"
            >
              {vm.confidence.known
                ? `Độ tin cậy: ${vm.confidence.display}`
                : "Độ tin cậy: chưa đánh giá"}
            </span>
          </div>
        </section>

        <WatchlistSaveButton
          checkId={row.id}
          initiallySaved={savedItem !== null}
          initialStatus={savedItem?.status}
        />

        {/* 2. CheckBDS Score — render server. Nhãn/điểm lấy từ adapter:
            score null hiện "—", deal_type null hiện "CHƯA CÓ NHẬN ĐỊNH". */}
        <section className="mt-4 rounded-[20px] bg-navy text-white p-5 md:p-6 flex items-center gap-5 relative overflow-hidden">
          <div className="absolute -top-16 right-0 w-[220px] h-[220px] bg-gold/15 rounded-full blur-[60px]" />
          <div className={`w-[84px] h-[84px] shrink-0 rounded-full bg-white border-[6px] flex items-center justify-center relative ${vm.score.known ? "border-emerald-500 text-emerald-700" : "border-slate-300 text-slate-500"}`}>
            <div className="text-center leading-none">
              <div className="text-[26px] font-black tracking-tight">{vm.score.known ? vm.score.value : "—"}</div>
              <div className="text-[10px] font-bold tracking-widest mt-0.5 opacity-70">/100</div>
            </div>
          </div>
          <div className="relative">
            <div className="text-[10px] tracking-[0.18em] font-bold text-slate-400">CHECKBDS SCORE</div>
            <div className="mt-1 inline-flex px-3 py-1 rounded-full text-[12px] font-black tracking-wide bg-gold text-navy">
              {vm.dealType.display}
            </div>
          </div>
        </section>

        {/* Dữ liệu còn thiếu + nguồn trích dẫn — chỉ hiện khi thật sự thiếu.
            Đây là nơi nói thẳng "chưa có", thay vì để ô trống im lặng. */}
        {(vm.missingData.length > 0 || vm.evidence.available) && (
          <section
            className="mt-4 rounded-[16px] border border-slate-200 bg-white p-5"
            aria-label="Phạm vi dữ liệu của báo cáo"
          >
            <h2 className="text-[13px] font-black text-navy">Phạm vi dữ liệu</h2>
            {vm.evidence.available ? (
              <>
                <p className="mt-1 text-[12px] text-slate-500">
                  Báo cáo này dựa trên {vm.evidence.refs.length} tín hiệu có nguồn ghi rõ.
                </p>
                <ul className="mt-3 space-y-2">
                  {vm.evidence.refs.map((r) => (
                    <li key={r.id} className="text-[12px] text-slate-600">
                      <span className="font-bold text-navy">{r.label}</span>
                      {r.excerpt ? ` — ${r.excerpt}` : ""}
                      <span className="ml-1 text-slate-400">
                        ({r.source === "listing_text" ? "nội dung tin" : "tính toán"})
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-1 text-[12px] text-slate-500">
                {vm.evidence.reason ?? "Chưa có nguồn trích dẫn thật."}
              </p>
            )}

            {vm.missingData.length > 0 && (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <div className="text-[11px] font-black tracking-wide text-slate-500">
                  CHƯA CÓ DỮ LIỆU CHO
                </div>
                <ul className="mt-1.5 space-y-1">
                  {vm.missingData.map((m) => (
                    <li key={m.field} className="text-[12px] text-slate-600">
                      • {m.display}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* 3-10. AI sections (Pro) hoặc locked list (Free) — client */}
        <div className="mt-4">
          <ProReport checkId={row.id} isPro={canViewPro} seed={seed} />
        </div>

        {/* Phân tích giá tham chiếu — lazy, độc lập với AI, tự gọi API khi mở */}
        <div className="mt-4">
          <PriceIntelligenceSection checkId={row.id} isPro={vm.entitlement.canViewPriceIntelligence} />
        </div>
      </div>
    </main>
  );
}
