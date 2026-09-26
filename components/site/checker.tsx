"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { exampleListings } from "@/lib/market-data";
import { runCheck, type CheckSource } from "@/lib/client-check";
import { extractFromUrl, firstUrl, isBareUrl } from "@/lib/client-extract";
import { parseCategoryUrl } from "@/lib/category-slug";
import type { AnalysisResult } from "@/lib/types";
import { ResultCard } from "@/components/site/result-card";
import { CategoryScan } from "@/components/dashboard/category-scan";

type Status = { kind: "idle" | "loading" | "ok" | "error"; text: string; reason?: string };

// Ô check duy nhất: dán link tin / link danh mục / mô tả tin -> Check bằng AI
export function Checker() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [source, setSource] = useState<CheckSource>("local");
  const [analyzedAt, setAnalyzedAt] = useState<string | undefined>(undefined);
  const [authRequired, setAuthRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  const [categoryUrl, setCategoryUrl] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const doCheck = async (payload: string, listingUrl?: string | null) => {
    setLoading(true);
    setStatus({ kind: "loading", text: "AI đang phân tích tin của bạn..." });
    try {
      const outcome = await runCheck(payload, { listingUrl: listingUrl ?? null });
      setResult(outcome.result);
      setSource(outcome.source);
      setAnalyzedAt(outcome.analyzedAt);
      setAuthRequired(Boolean(outcome.authRequired));
      setStatus({ kind: "idle", text: "" });
      router.refresh();
      setTimeout(
        () => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        100,
      );
    } finally {
      setLoading(false);
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
      await doCheck(r.text, url);
      return;
    }

    // 3) Văn bản thuần -> chấm thẳng
    setCategoryUrl(null);
    await doCheck(raw);
  };

  const resetToInput = () => {
    setCategoryUrl(null);
    setResult(null);
    setText("");
    setAuthRequired(false);
    setStatus({ kind: "idle", text: "" });
    document.getElementById("kiem-tra")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <div id="kiem-tra" className="scroll-mt-20 mx-auto max-w-[1120px] px-5 md:px-8 relative z-10 -mt-10 md:-mt-14">
        <div className="bg-white rounded-[20px] md:rounded-[24px] shadow-[0_24px_90px_-20px_rgba(0,0,0,0.45)] border border-slate-200/70 overflow-hidden max-w-[780px]">
          <div className="p-4 md:p-7">
            <div className="flex items-center justify-between mb-3">
              <label
                htmlFor="listing"
                className="text-[12px] font-bold tracking-[0.12em] text-slate-500 uppercase"
              >
                Dán mô tả tin, link tin hoặc link danh mục
              </label>
              <span className="text-[11px] tabular-nums text-slate-400">{text.length}/1000</span>
            </div>

            <Textarea
              id="listing"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
              placeholder="Bán gấp! Nhà mặt tiền Thùy Vân 80m2, 4 tầng, ngân hàng thanh lý, giá 5.5 tỷ, sổ hồng riêng, hẻm xe hơi... hoặc dán link tin / link danh mục"
              className="w-full min-h-[132px] md:min-h-[148px] resize-none rounded-[14px] bg-cream border-slate-200 px-4 py-3.5 text-[15px] leading-[1.6] placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-navy/15 focus-visible:border-navy/30"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {exampleListings.map((ex, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setText(ex)}
                  className="text-[11px] px-3 py-1.5 rounded-full bg-slate-100 hover:bg-navy hover:text-white text-slate-600 border border-slate-200 transition"
                >
                  Thử ví dụ {i + 1}
                </button>
              ))}
            </div>

            <div className="mt-5">
              <Button
                type="button"
                onClick={handleCheck}
                disabled={!text.trim() || loading}
                className="h-[52px] w-full rounded-[12px] bg-gradient-to-r from-navy to-[#16305f] hover:from-[#0e2547] hover:to-[#1a3868] disabled:opacity-50 text-white text-[15px] font-bold shadow-[0_10px_28px_-8px_rgba(11,29,58,0.7)]"
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

            {status.text && (
              <div
                className={`mt-3 text-[12px] leading-snug rounded-[10px] px-3 py-2 ${
                  status.kind === "error"
                    ? "bg-amber-50 text-amber-800 border border-amber-200"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {status.text}
                {status.kind === "error" && (
                  <div className="mt-1 text-slate-500">
                    Cách thay thế: mở tin rao, copy đoạn mô tả (tiêu đề, giá, diện tích, pháp lý) rồi dán vào ô trên.
                  </div>
                )}
              </div>
            )}

            {categoryUrl && (
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <div className="text-[12px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                    Đang quét danh mục
                  </div>
                  <button
                    type="button"
                    onClick={resetToInput}
                    className="text-[12px] font-bold text-navy hover:underline underline-offset-2"
                  >
                    ← Check tin khác
                  </button>
                </div>
                <CategoryScan url={categoryUrl} />
              </div>
            )}
          </div>

          <div className="px-4 md:px-7 h-[44px] flex items-center justify-between bg-cream border-t border-slate-200 text-[11px]">
            <div className="flex items-center gap-2 text-slate-500">
              <span>🛡️ Tin chỉ dùng để chấm điểm, không chia sẻ</span>
            </div>
            <a href="/pricing" className="font-semibold text-navy hover:underline">
              Cần check số lượng lớn? Xem gói PRO →
            </a>
          </div>
        </div>
      </div>

      {result && (
        <section
          ref={resultRef}
          className="mx-auto max-w-[1120px] px-5 md:px-8 mt-8 scroll-mt-20 pb-4"
        >
          <ResultCard
            result={result}
            source={source}
            analyzedAt={analyzedAt}
            authRequired={authRequired}
            onCheckAnother={resetToInput}
          />
        </section>
      )}
    </>
  );
}
