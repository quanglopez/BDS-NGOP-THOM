"use client";

import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { exampleListings } from "@/lib/market-data";
import { runCheck, type CheckSource } from "@/lib/client-check";
import type { AnalysisResult } from "@/lib/types";
import { ResultCard } from "@/components/site/result-card";

// Hero + ô dán tin + nút chấm điểm
export function Checker() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [source, setSource] = useState<CheckSource>("local");
  const [loading, setLoading] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const handleCheck = async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      const outcome = await runCheck(text);
      setResult(outcome.result);
      setSource(outcome.source);
      setTimeout(
        () => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        100,
      );
    } finally {
      setLoading(false);
    }
  };

  // Dán nội dung clipboard; không đọc được thì chèn link mẫu
  const handlePaste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) {
        setText(clip);
        return;
      }
    } catch {
      // bỏ qua, dùng fallback bên dưới
    }
    setText((prev) => prev + (prev ? "\n" : "") + "https://batdongsan.com.vn/...");
  };

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-navy" />
        <div className="absolute inset-0 bg-gradient-to-br from-navy via-[#132A56] to-navy" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gold/10 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[90px] translate-y-1/2 -translate-x-1/4" />

        <div className="relative mx-auto max-w-[1120px] px-5 md:px-8 pt-12 md:pt-20 pb-16 md:pb-24">
          <div className="max-w-[760px]">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] tracking-[0.12em] text-amber-200 font-semibold mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              AI ĐANG SCAN 1,247 TIN MỚI VŨNG TÀU HÔM NAY
            </div>
            <h1 className="text-[32px] md:text-[54px] font-black leading-[0.95] tracking-[-0.03em] text-white">
              Dán tin BĐS vào đây
              <br />
              <span className="text-gold">Biết ngay kèo Ngộp</span>
              <br />
              hay Thơm
            </h1>
            <p className="mt-4 text-[16px] md:text-[18px] leading-[1.5] text-slate-300 font-medium max-w-[560px]">
              AI chấm điểm tiềm năng đầu tư BĐS Vũng Tàu trong 1s. Phát hiện bán gấp, so sánh giá thị trường, đánh
              giá pháp lý.
            </p>
          </div>

          <div className="mt-8 md:mt-10 bg-white rounded-[20px] md:rounded-[24px] shadow-[0_20px_80px_-20px_rgba(0,0,0,0.5)] border border-slate-200/70 overflow-hidden max-w-[760px]">
            <div className="p-4 md:p-7">
              <div className="flex items-center justify-between mb-3">
                <label
                  htmlFor="listing"
                  className="text-[12px] font-bold tracking-[0.12em] text-slate-500 uppercase"
                >
                  Tin rao Batdongsan / Chotot / Facebook
                </label>
                <span className="text-[11px] text-slate-400">{text.length}/1000</span>
              </div>

              <Textarea
                id="listing"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1000}
                placeholder="Bán gấp! Nhà mặt tiền Thùy Vân 80m2, 4 tầng, ngân hàng thanh lý, giá 5.5 tỷ (rẻ hơn thị trường 1 tỷ), sổ hồng riêng, hẻm xe hơi..."
                className="w-full min-h-[132px] md:min-h-[148px] resize-none rounded-[14px] bg-cream border-slate-200 px-4 py-3.5 text-[15px] leading-[1.6] placeholder:text-slate-400 focus-visible:ring-[#0B1D3A]/10 focus-visible:border-[#0B1D3A]/20"
              />

              <div className="mt-3 flex flex-wrap gap-2">
                {exampleListings.map((ex, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setText(ex)}
                    className="text-[11px] px-2.5 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 transition"
                  >
                    Ví dụ {i + 1}: {ex.slice(0, 36)}...
                  </button>
                ))}
              </div>

              <div className="mt-5 flex flex-col sm:flex-row gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePaste}
                  className="h-[48px] px-5 rounded-[12px] border-slate-200 bg-white hover:bg-slate-50 text-[14px] font-semibold text-slate-700"
                >
                  <span>📋</span> Dán link Batdongsan
                </Button>

                <Button
                  type="button"
                  onClick={handleCheck}
                  disabled={!text.trim() || loading}
                  className="h-[48px] flex-1 rounded-[12px] bg-navy hover:bg-[#112a5a] disabled:opacity-50 text-white text-[15px] font-bold shadow-[0_8px_24px_-8px_rgba(11,29,58,0.6)]"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      AI đang chấm...
                    </>
                  ) : (
                    <>
                      <span>🔍</span> Check bằng AI
                    </>
                  )}
                </Button>
              </div>

              <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                <span className="w-1 h-1 rounded-full bg-emerald-500" />
                {source === "ai"
                  ? "Chấm điểm bằng AI thật"
                  : "Chấm điểm local • Đăng nhập để dùng AI thật"}
                {" • "}Qua{" "}
                <code className="px-1.5 py-0.5 rounded bg-slate-100 border">/api/check</code>, key giữ ở server
              </div>
            </div>

            <div className="h-[44px] px-4 md:px-7 flex items-center justify-between bg-cream border-t border-slate-200 text-[11px]">
              <div className="flex items-center gap-3 text-slate-500">
                <span>🛡️ Không lưu tin của bạn</span>
                <span className="hidden sm:inline">•</span>
                <span className="hidden sm:inline">Phân tích trong 0.8s</span>
              </div>
              <div className="text-slate-400">Vercel-ready • Edge Function</div>
            </div>
          </div>
        </div>
      </section>

      {result && (
        <section
          ref={resultRef}
          className="mx-auto max-w-[1120px] px-5 md:px-8 -mt-6 md:-mt-8 relative z-10 pb-10"
        >
          <ResultCard result={result} onCheckAnother={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
        </section>
      )}
    </>
  );
}
