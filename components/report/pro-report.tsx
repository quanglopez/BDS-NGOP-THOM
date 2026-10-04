"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics";
import type { ProAnalysis } from "@/lib/ai/schema";
import { fmtPpm2, fmtVnd } from "@/lib/price/format";
import {
  buildReportViewModel,
  type ReportViewModel,
} from "@/lib/report/view-model";

export interface FactorContribution {
  label: string;
  delta: number;
  note: string;
}

export interface ReportSeed {
  score: number | null;
  dealType: string | null;
  title: string | null;
  price: number | null;
  area: number | null;
  pricePerM2: number | null;
  bedrooms: number | null;
  ward: string | null;
  region: string | null;
  listingUrl: string | null;
  confidence?: number | null;
  factorContributions?: FactorContribution[] | null;
}

interface ApiOk {
  ok: true;
  cached: boolean;
  fromFallback: boolean;
  analysis: ProAnalysis;
  analysis_version: string;
  ai_model: string | null;
}

const LOCKED_MODULES = [
  "Vì sao được điểm này?",
  "Phân tích các yếu tố",
  "Điểm mạnh & điểm cần lưu ý",
  "Phân tích giá chuyên sâu",
  "BĐS tương đồng",
  "Cảnh báo chuyên sâu",
  "Nhận định CheckBDS",
  "Checklist trước khi xuống tiền",
];

function fmtPrice(v: number | null): string {
  if (v === null) return "—";
  return fmtVnd(v, v % 1_000_000_000 === 0 ? 0 : 2);
}

function Skeleton() {
  return (
    <div className="rounded-[16px] border border-slate-200 bg-white p-5 md:p-6" aria-busy="true">
      <div className="h-4 w-48 rounded bg-slate-200 animate-pulse" />
      <div className="mt-3 space-y-2">
        <div className="h-3 rounded bg-slate-100 animate-pulse" />
        <div className="h-3 w-5/6 rounded bg-slate-100 animate-pulse" />
        <div className="h-3 w-4/6 rounded bg-slate-100 animate-pulse" />
      </div>
      <p className="mt-3 text-[12px] text-slate-400">Đang tạo phân tích chuyên sâu…</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[15px] font-black text-navy">{children}</h3>;
}

function factorDelta(
  factorName: string,
  contributions: FactorContribution[] | null | undefined,
): number | null {
  if (!contributions || contributions.length === 0) return null;
  const needle = factorName.trim().toLowerCase();
  const c = contributions.find((c) => {
    const lbl = c.label.trim().toLowerCase();
    return lbl === needle || lbl.includes(needle) || needle.includes(lbl);
  });
  return c ? c.delta : null;
}

// Report Pro: Free thấy locked list (không gọi AI). Pro fetch /api/pro-analysis 1 lần.
export function ProReport({ checkId, isPro, seed }: { checkId: string; isPro: boolean; seed: ReportSeed }) {
  const [data, setData] = useState<ApiOk | null>(null);
  const startedRef = useRef(false);
  const viewedRef = useRef({ analysis: false, breakdown: false, redflag: false, price: false });
  // View model dùng chung cho cả 3 trạng thái loading / xong / lỗi: component
  // không tự quyết "câu nào hiện khi nào", mà đọc trạng thái đã chuẩn hoá.
  const [vm, setVm] = useState<ReportViewModel>(() =>
    buildReportViewModel({ loading: true, plan: isPro ? "pro" : "free" }),
  );

  useEffect(() => {
    if (!isPro) {
      trackEvent("pro_locked_section_view", { checkId });
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    trackEvent("pro_analysis_view", { checkId });
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pro-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkId }),
        });
        const json = (await res.json().catch(() => null)) as ApiOk | { error?: string } | null;
        if (cancelled) return;
        if (!res.ok || !json || !("analysis" in json)) {
          setVm(
            buildReportViewModel({
              check: { id: checkId },
              plan: isPro ? "pro" : "free",
              failed: true,
              // Chỉ lỗi tạm thời phía server mới retry được. 429 (hết lượt),
              // 401/403 (sai sở hữu), 404 (không còn tin) thì retry vô nghĩa.
              retrySupported: res.status >= 500,
            }),
          );
          return;
        }
        setData(json as ApiOk);
        setVm(
          buildReportViewModel({
            check: { id: checkId, score: seed.score, deal_type: seed.dealType },
            plan: isPro ? "pro" : "free",
            proAnalysis: (json as ApiOk).analysis,
          }),
        );
        // Section-view events khi dữ liệu AI đã về
        if (!viewedRef.current.analysis) {
          viewedRef.current.analysis = true;
        }
        trackEvent("score_breakdown_view", { checkId });
        viewedRef.current.breakdown = true;
        trackEvent("red_flag_view", { checkId });
        viewedRef.current.redflag = true;
        trackEvent("price_intelligence_view", { checkId });
        viewedRef.current.price = true;
      } catch {
        // Lỗi mạng/offline: có thể thử lại.
        if (!cancelled) {
          setVm(
            buildReportViewModel({
              check: { id: checkId },
              plan: "pro",
              failed: true,
              retrySupported: true,
            }),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // seed.score/seed.dealType là props server render 1 lần cho đúng checkId;
    // startedRef chặn chạy lại nên thêm vào deps không gây fetch lần 2.
  }, [checkId, isPro, seed.score, seed.dealType]);

  if (!isPro) {
    return (
      <div className="rounded-[18px] border border-slate-200 bg-white p-5 md:p-6">
        <h3 className="text-[15px] font-black text-navy">Mở khóa phân tích Pro</h3>
        <p className="mt-1 text-[13px] text-slate-500">
          Không chỉ xem điểm số — hiểu vì sao bất động sản được chấm như vậy.
        </p>
        <ul className="mt-4 space-y-2">
          {LOCKED_MODULES.map((m) => (
            <li
              key={m}
              className="flex items-center gap-2 rounded-[10px] border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[13px] font-semibold text-slate-500"
            >
              <span aria-hidden="true">🔒</span> {m}
            </li>
          ))}
        </ul>
        <Link
          href="/pricing#thanh-toan"
          onClick={() => {
            trackEvent("pro_unlock_click", { checkId });
            trackEvent("upgrade_from_report_click", { checkId });
          }}
          className="mt-5 h-[48px] w-full rounded-[12px] bg-gradient-to-r from-[#C9A86A] to-[#d8ba7f] text-navy text-[14px] font-black flex items-center justify-center hover:from-[#d8ba7f] hover:to-[#e3ca92] transition"
        >
          MỞ KHÓA PHÂN TÍCH PRO
        </Link>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          Pro mở toàn bộ module trên cho mọi report của bạn.
        </p>
      </div>
    );
  }

  if (vm.status === "failed" || (data && data.fromFallback && !data.analysis)) {
    return (
      <div className="rounded-[16px] border border-amber-200 bg-amber-50 p-5 text-[13px] text-amber-800">
        {vm.retry.supported
          ? "Phân tích AI tạm thời chưa khả dụng. Các dữ liệu và chỉ số CheckBDS vẫn được hiển thị bên dưới."
          : "Không tạo được phân tích AI cho lần xem này (lỗi không tạm thời — thử lại cũng không khác). Các dữ liệu và chỉ số CheckBDS vẫn được hiển thị bên dưới."}
      </div>
    );
  }

  if (!data) return <Skeleton />;

  const a = data.analysis;
  // Câu chữ lấy từ view model (đã chuẩn hoá), không đọc thẳng `a.summary`.
  const headline = vm.proSummary?.headline ?? a.summary.headline;
  const summaryText = vm.proSummary?.text ?? a.summary.text;

  return (
    <div className="space-y-5">
      {data.fromFallback && (
        <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          Phân tích AI tạm thời chưa khả dụng — bên dưới là phân tích xác định từ dữ liệu thật của tin.
          Các dữ liệu và chỉ số CheckBDS vẫn được hiển thị đầy đủ.
        </div>
      )}

      {/* 3. Nhận định nhanh */}
      <section className="rounded-[18px] bg-navy text-white p-5 md:p-6 relative overflow-hidden">
        <div className="absolute -top-16 right-0 w-[220px] h-[220px] bg-gold/15 rounded-full blur-[60px]" />
        <div className="relative flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-black tracking-[0.14em] text-gold">NHẬN ĐỊNH TỪ CHECKBDS</span>
          {data.fromFallback ? (
            <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[10px] font-bold text-slate-200">
              Phân tích cơ bản từ dữ liệu
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[10px] font-bold text-slate-200">
              AI Analysis
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[10px] font-bold text-slate-200">
            AI hỗ trợ phân tích
          </span>
        </div>
        <h3 className="relative mt-2 text-[17px] font-black leading-snug">{headline}</h3>
        <p className="relative mt-2 text-[13px] leading-[1.7] text-slate-200">{summaryText}</p>
      </section>

      {/* 4. Highlights */}
      {a.highlights.length > 0 && (
        <section className="grid gap-2.5 md:grid-cols-3">
          {a.highlights.slice(0, 3).map((h, i) => (
            <div
              key={i}
              className={`rounded-[14px] border p-4 ${
                h.type === "positive"
                  ? "border-emerald-200 bg-emerald-50/70"
                  : h.type === "warning"
                    ? "border-amber-200 bg-amber-50/70"
                    : "border-slate-200 bg-white"
              }`}
            >
              <div className="text-[13px] font-black text-navy">
                {h.type === "positive" ? "↑ " : h.type === "warning" ? "⚠ " : ""}
                {h.title}
              </div>
              <p className="mt-1 text-[12px] text-slate-600 leading-relaxed">{h.explanation}</p>
            </div>
          ))}
        </section>
      )}

      {/* 5. Vì sao được điểm */}
      <section className="rounded-[18px] border border-slate-200 bg-white p-5 md:p-6">
        <SectionTitle>{seed.score !== null ? `Vì sao BĐS này được ${seed.score}/100?` : "Vì sao BĐS này chưa được chấm điểm?"}</SectionTitle>
        <p className="mt-1 text-[12px] text-slate-500">{a.score_explanation.summary}</p>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div>
            <div className="text-[12px] font-black tracking-wide text-emerald-700">ĐIỂM TÍCH CỰC</div>
            <div className="mt-2 space-y-2.5">
              {a.score_explanation.strengths.map((s, i) => (
                <div key={i}>
                  <div className="text-[13px] font-bold text-slate-800">↑ {s.title}</div>
                  <div className="text-[12px] text-slate-500">{s.explanation}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[12px] font-black tracking-wide text-red-600">ĐIỂM CẦN LƯU Ý</div>
            <div className="mt-2 space-y-2.5">
              {a.score_explanation.weaknesses.map((s, i) => (
                <div key={i}>
                  <div className="text-[13px] font-bold text-slate-800">↓ {s.title}</div>
                  <div className="text-[12px] text-slate-500">{s.explanation}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 6. Phân tích các yếu tố */}
      {a.factor_analysis.length > 0 && (
        <section className="rounded-[18px] border border-slate-200 bg-white p-5 md:p-6">
          <SectionTitle>Phân tích các yếu tố</SectionTitle>
          <p className="mt-1 text-[11px] text-slate-400">
            Mỗi yếu tố kèm số điểm cộng/trừ mô hình CheckBDS đã áp dụng (nguồn: scoring snapshot
            của lần check, không tự suy ra). Nếu không đọc được delta — không tự điền con số.
          </p>
          <div className="mt-4 space-y-3">
            {a.factor_analysis.map((f, i) => {
              const delta = factorDelta(f.factor, seed.factorContributions ?? null);
              const deltaLabel = delta === null ? null : `${delta > 0 ? "+" : ""}${delta} điểm`;
              return (
                <div key={i}>
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="font-bold text-navy">{f.factor}</span>
                    {delta !== null && (
                      <span
                        className={`font-black tabular-nums rounded px-1.5 py-0.5 ${
                          delta > 0
                            ? "bg-emerald-50 text-emerald-700"
                            : delta < 0
                              ? "bg-red-50 text-red-700"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {deltaLabel}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] text-slate-500">{f.explanation}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 7. Phân tích giá — chỉ phần AI thật sự biết.
          KHÔNG hiện "giá thị trường / chênh lệch / chưa đủ dữ liệu tham chiếu":
          Evidence Pack của pro-v1 chưa nối price intelligence, nên các ô đó luôn
          rỗng và câu "chưa đủ dữ liệu" sẽ mâu thuẫn với section
          "Phân tích giá tham chiếu" bên dưới (nơi mới là nơi có số thật). */}
      <section className="rounded-[18px] border border-slate-200 bg-white p-5 md:p-6">
        <SectionTitle>Phân tích giá</SectionTitle>
        <div className="mt-3 grid grid-cols-2 gap-3 text-center">
          <div className="rounded-[12px] bg-cream border border-slate-200 p-3">
            <div className="text-[11px] text-slate-500">Giá chào bán</div>
            <div className="mt-1 text-[15px] font-black text-navy">{fmtPrice(seed.price)}</div>
          </div>
          <div className="rounded-[12px] bg-cream border border-slate-200 p-3">
            <div className="text-[11px] text-slate-500">Giá/m²</div>
            <div className="mt-1 text-[15px] font-black text-navy">{fmtPpm2(seed.pricePerM2)}</div>
          </div>
        </div>
        <p className="mt-3 text-[13px] text-slate-600 leading-relaxed">{a.price_analysis.explanation}</p>
      </section>

      {/* 8. Red flags */}
      {a.warnings.length > 0 && (
        <section className="rounded-[18px] border border-slate-200 bg-white p-5 md:p-6">
          <SectionTitle>⚠ Điểm cần kiểm tra trước khi xuống tiền</SectionTitle>
          <div className="mt-3 space-y-2.5">
            {a.warnings.map((w, i) => (
              <div
                key={i}
                className={`rounded-[12px] border p-3.5 ${
                  w.severity === "high"
                    ? "border-red-200 bg-red-50/60"
                    : w.severity === "medium"
                      ? "border-amber-200 bg-amber-50/60"
                      : "border-emerald-200 bg-emerald-50/60"
                }`}
              >
                <div className="flex items-center gap-2 text-[13px] font-black text-navy">
                  <span>{w.severity === "high" ? "🔴" : w.severity === "medium" ? "🟠" : "🟢"}</span>
                  {w.title}
                </div>
                <p className="mt-1 text-[12px] text-slate-600">{w.explanation}</p>
                {w.requires_verification && (
                  <p className="mt-1 text-[11px] text-slate-400">Cần xác minh thêm trước khi quyết định.</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 9. Action plan */}
      {a.next_steps.length > 0 && (
        <section className="rounded-[18px] border border-slate-200 bg-white p-5 md:p-6">
          <SectionTitle>Nên kiểm tra gì tiếp theo?</SectionTitle>
          <ul className="mt-3 space-y-2.5">
            {a.next_steps.map((n, i) => (
              <li key={i} className="flex gap-2.5 text-[13px]">
                <span
                  className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center text-[10px] font-black ${
                    n.priority === "high"
                      ? "border-red-400 text-red-500"
                      : n.priority === "medium"
                        ? "border-amber-400 text-amber-600"
                        : "border-slate-300 text-slate-400"
                  }`}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <div>
                  <span className="font-bold text-slate-800">☐ {n.title}</span>
                  <span className="text-slate-500"> — {n.reason}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 10. Limitations */}
      <section className="rounded-[14px] bg-slate-50 border border-slate-200 p-4 text-[12px] text-slate-500 leading-relaxed">
        <span className="font-black text-slate-600">Giới hạn dữ liệu: </span>
        {a.limitations.length > 0
          ? a.limitations.join(" ")
          : "CheckBDS phân tích dựa trên nội dung tin đăng và các nguồn dữ liệu hiện có. Một số thông tin cần được xác minh trực tiếp với chủ sở hữu, cơ quan có thẩm quyền hoặc chuyên gia."}
      </section>
    </div>
  );
}
