"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { runCheck, fetchQuota, type CheckSource } from "@/lib/client-check";
import { extractFromUrl, firstUrl, isBareUrl } from "@/lib/client-extract";
import { parseCategoryUrl } from "@/lib/category-slug";
import type { AnalysisResult } from "@/lib/types";
import type { QuotaInfo } from "@/lib/types";
import { trackEvent } from "@/lib/analytics";
import { ResultCard } from "@/components/site/result-card";
import { CategoryScan } from "@/components/dashboard/category-scan";
import { UpgradeModal } from "@/components/site/upgrade-modal";

type Status = { kind: "idle" | "loading" | "ok" | "error" | "limit"; text: string; reason?: string };

// Ô check duy nhất trong dashboard: dán link tin / link danh mục / mô tả tin -> Check bằng AI
export function QuickCheck() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [source, setSource] = useState<CheckSource>("local");
  const [analyzedAt, setAnalyzedAt] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  // Link danh mục -> chuyển sang luồng quét danh mục
  const [categoryUrl, setCategoryUrl] = useState<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Quota lấy từ server, không hardcode trong UI
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  // ID dòng checks vừa lưu (để mở /bao-cao/[id]); null khi preview local
  const [checkId, setCheckId] = useState<string | null>(null);
  const [seoSlug, setSeoSlug] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Sau mỗi lần check: đồng bộ quota, chỉ mời nâng cấp khi thật sự hết lượt
  const syncQuota = async () => {
    const q = await fetchQuota();
    if (!q) return;
    setQuota(q);
    if (typeof q.remaining === "number" && q.remaining <= 0) {
      trackEvent("free_limit_reached", { plan: q.plan, limit: q.limit });
      setUpgradeOpen(true);
    }
  };

  const doCheck = async (
    payload: string,
    listingUrl?: string | null,
    geo?: { ward: string | null; region: string | null; areaHint: string | null },
  ) => {
    setLoading(true);
    setStatus({ kind: "loading", text: "AI đang phân tích tin của bạn..." });
    try {
      const outcome = await runCheck(payload, {
        listingUrl: listingUrl ?? null,
        // Địa lý có cấu trúc từ gateway -> /api/check ghi vào checks. Thiếu thì
        // Price Intelligence chỉ lên được tỉnh.
        ward: geo?.ward ?? null,
        region: geo?.region ?? null,
        // Diện tích có cấu trúc: mô tả tin hay chứa dải ("62-82,5-105,5m2") nên
        // để /api/check quét text sẽ ra số sai.
        areaHint: geo?.areaHint ?? null,
      });

      // Hết lượt: nói rõ + mời nâng cấp, KHÔNG hiện kết quả dự phòng như thể thành công
      if (outcome.quotaExhausted) {
        setResult(null);
        setStatus({ kind: "limit", text: outcome.serverError ?? "Bạn đã hết lượt check hôm nay." });
        await syncQuota();
        return;
      }

      setResult(outcome.result);
      setSource(outcome.source);
      setAnalyzedAt(outcome.analyzedAt);
      setCheckId(outcome.checkId ?? null);
      setSeoSlug(outcome.seoSlug ?? null);
      setStatus({ kind: "idle", text: "" });
      router.refresh();
      setTimeout(
        () => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        100,
      );
    } finally {
      setLoading(false);
      void syncQuota();
    }
  };

  const handleCheck = async () => {
    const raw = text.trim();
    if (!raw || loading) return;

    // 1) Link danh mục Chợ Tốt/Nhà Tốt -> quét danh sách nhiều tin
    const url = isBareUrl(raw) ? raw : firstUrl(raw);
    if (url && parseCategoryUrl(url)) {
      setCategoryUrl(url);
      setResult(null);
      setStatus({ kind: "idle", text: "" });
      return;
    }

    // 2) Link 1 tin -> lấy nội dung trang rồi chấm
    if (url) {
      setCategoryUrl(null);
      setStatus({ kind: "loading", text: "Đang lấy nội dung tin từ link..." });
      const r = await extractFromUrl(url);
      if (!r.ok) {
        setStatus({ kind: "error", text: r.message, reason: r.reason });
        return;
      }
      setText(r.text);
      await doCheck(r.text, url, {
        ward: r.ward_name,
        region: r.region_name,
        areaHint: r.area_hint,
      });
      return;
    }

    // 3) Văn bản thuần -> chấm thẳng
    setCategoryUrl(null);
    await doCheck(raw);
  };

  const   resetToInput = () => {
    setCategoryUrl(null);
    setResult(null);
    setText("");
    setCheckId(null);
    setSeoSlug(null);
    setStatus({ kind: "idle", text: "" });
  };

  return (
    <>
      <section className="mt-6 rounded-[20px] border border-slate-200 bg-white shadow-[0_16px_50px_-24px_rgba(11,29,58,0.3)] overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-black tracking-tight text-navy">Check tin bằng AI</h2>
              <p className="mt-1 text-[12px] text-slate-500">
                Dán <b>link 1 tin</b>, <b>link trang danh mục</b> hoặc <b>mô tả tin</b> — bấm Check, tool tự xử lý.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {categoryUrl && (
                <button
                  type="button"
                  onClick={resetToInput}
                  className="text-[12px] font-bold text-navy hover:underline underline-offset-2"
                >
                  ← Check tin khác
                </button>
              )}
              <span className="text-[11px] tabular-nums text-slate-400">{text.length}/1000</span>
            </div>
          </div>

          {!categoryUrl && (
            <>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1000}
                placeholder="Bán gấp! Nhà mặt tiền Thùy Vân 80m2, ngân hàng thanh lý, giá 5.5 tỷ, sổ hồng riêng... (hoặc dán link tin / link danh mục)"
                className="mt-4 w-full min-h-[130px] resize-none rounded-[14px] bg-cream border-slate-200 px-4 py-3 text-[14px] leading-[1.6] placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-navy/15 focus-visible:border-navy/30"
              />

              <div className="mt-4">
                <Button
                  type="button"
                  onClick={handleCheck}
                  disabled={!text.trim() || loading}
                  className="h-[50px] w-full rounded-[12px] bg-gradient-to-r from-navy to-[#16305f] hover:from-[#0e2547] hover:to-[#1a3868] disabled:opacity-50 text-white text-[15px] font-bold shadow-[0_10px_28px_-8px_rgba(11,29,58,0.7)]"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      AI đang phân tích...
                    </>
                  ) : (
                    <>
                      <span>🔍</span> Check bằng AI
                    </>
                  )}
                </Button>
              </div>
            </>
          )}

          {status.text && (
            <div
              className={`mt-3 text-[12px] leading-snug rounded-[10px] px-3 py-2 ${
                status.kind === "limit"
                  ? "bg-amber-50 text-amber-900 border border-amber-200"
                  : status.kind === "error"
                    ? "bg-amber-50 text-amber-800 border border-amber-200"
                    : "bg-slate-100 text-slate-600"
              }`}
            >
              {status.text}
              {status.kind === "limit" ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setUpgradeOpen(true)}
                    className="h-9 px-4 rounded-[10px] bg-navy text-white text-[12px] font-bold"
                  >
                    Nâng cấp PRO
                  </button>
                  <button
                    type="button"
                    onClick={() => setUpgradeOpen(false)}
                    className="text-[12px] text-slate-500 hover:text-slate-700"
                  >
                    Để sau
                  </button>
                </div>
              ) : (
                status.kind === "error" && (
                  <div className="mt-1 text-slate-500">
                    Cách thay thế: mở tin rao, copy đoạn mô tả (tiêu đề, giá, diện tích, pháp lý) rồi dán vào ô trên.
                  </div>
                )
              )}
            </div>
          )}

          {/* Còn bao nhiêu lượt hôm nay — giúp khách tự quyết định có cần nâng cấp không */}
          {quota && !result && (
            <p className="mt-2 text-[11px] text-slate-400">
              Hôm nay còn <b className="text-slate-600">{quota.remaining}</b>/{quota.limit} lượt
              {quota.credits > 0 ? ` (+${quota.credits} credits)` : ""}
            </p>
          )}

          {categoryUrl && <CategoryScan url={categoryUrl} />}
        </div>

        {result && (
          <div ref={resultRef} className="px-5 md:px-6 pb-5 md:pb-6 scroll-mt-24">
            <ResultCard
              result={result}
              source={source}
              analyzedAt={analyzedAt}
              isPro={quota?.plan != null && quota.plan !== "free"}
              checkId={checkId}
              seoSlug={seoSlug}
              onCheckAnother={resetToInput}
            />
          </div>
        )}
      </section>

      <UpgradeModal
        open={upgradeOpen}
        dailyLimit={quota?.limit ?? 0}
        plan={quota?.plan ?? "free"}
        onClose={() => setUpgradeOpen(false)}
      />
    </>
  );
}
