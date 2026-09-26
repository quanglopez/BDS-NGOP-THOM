"use client";

import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { exampleListings } from "@/lib/market-data";
import { runCheck, type CheckSource } from "@/lib/client-check";
import { extractFromUrl, firstUrl, isBareUrl } from "@/lib/client-extract";
import { ocrImageToText } from "@/lib/ocr";
import type { AnalysisResult } from "@/lib/types";
import { ResultCard } from "@/components/site/result-card";
import OcrButton from "@/components/site/ocr-button";

// Chỉ hiện domain trong thông báo, không lộ toàn bộ URL
function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "trang";
  }
}

// Hero + ô dán tin + nút chấm điểm
export function Checker() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [source, setSource] = useState<CheckSource>("local");
  const [analyzedAt, setAnalyzedAt] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [extractState, setExtractState] = useState<{ kind: "idle" | "loading" | "ok" | "error"; text: string }>({
    kind: "idle",
    text: "",
  });
  const [ocrState, setOcrState] = useState<{ busy: boolean; progress: number; text: string }>({ busy: false, progress: 0, text: "" });
  const resultRef = useRef<HTMLDivElement>(null);

  const handleCheck = async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      const outcome = await runCheck(text);
      setResult(outcome.result);
      setSource(outcome.source);
      setAnalyzedAt(outcome.analyzedAt);
      setTimeout(
        () => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        100,
      );
    } finally {
      setLoading(false);
    }
  };

  // Dán link tin rao: nếu clipboard chứa URL thì tự lấy nội dung trang,
  // lấy được thì điền vào ô; không được thì báo rõ để khách copy tay
  const handlePaste = async () => {
    let clip = "";
    try {
      clip = await navigator.clipboard.readText();
    } catch {
      setExtractState({
        kind: "error",
        text: "Trình duyệt không cho đọc clipboard. Hãu dán trực tiếp (Ctrl+V) vào ô bên dưới.",
      });
      return;
    }

    if (!clip.trim()) {
      setExtractState({ kind: "error", text: "Clipboard trống — hãy copy link hoặc mô tả tin rồi dán." });
      return;
    }

    const url = isBareUrl(clip) ? clip.trim() : firstUrl(clip);
    if (!url) {
      // Không phải link -> dán luôn nội dung mô tả tin
      setText(clip);
      setExtractState({ kind: "idle", text: "" });
      return;
    }

    setExtractState({ kind: "loading", text: `Đang đọc trang ${safeDomain(url)}...` });
    const result = await extractFromUrl(url);

    if (result.ok) {
      setText(result.text);
      setExtractState({
        kind: "ok",
        text: `Đã lấy nội dung từ ${result.domain} (${result.text.length} ký tự). Kiểm tra rồi bấm Check.`,
      });
      return;
    }

    // Giữ lại phần text khách đã dán kèm (nếu có) để không mất gì
    setText(isBareUrl(clip) ? "" : clip);
    setExtractState({ kind: "error", text: result.message });
  };

  // Anh chup man hinh tin rao (Zalo/Facebook): OCR ngay trong trinh duyet roi dien vao o
  const handleOcrFile = async (file: File) => {
    if (ocrState.busy) return;
    if (file.size > 12 * 1024 * 1024) {
      setOcrState({ busy: false, progress: 0, text: "Anh qua nang (vuot 12MB). Hay chup lai gon hon." });
      return;
    }
    setOcrState({ busy: true, progress: 0, text: "Dang tai bo nhan dang tieng Viet (lan dau hoi lau)..." });
    try {
      const text = await ocrImageToText(file, (pct) =>
        setOcrState({ busy: true, progress: pct, text: `Dang doc chu trong anh... ${pct}%` }),
      );
      setText(text.slice(0, 1000));
      setOcrState({ busy: false, progress: 100, text: `Da doc ${text.length} ky tu tu anh. Kiem tra roi bam Check.` });
    } catch {
      setOcrState({ busy: false, progress: 0, text: "Khong doc duoc chu trong anh nay. Thu anh ro net hon, hoac copy mo ta tin roi dan vao o." });
    }
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
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              CHẤM ĐIỂM 6 TIÊU CHÍ • LỌC KÈO NGỘP &gt;80 ĐIỂM
            </div>
            <h1 className="text-[32px] md:text-[54px] font-black leading-[0.95] tracking-[-0.03em] text-white">
              Dán tin BĐS vào đây
              <br />
              <span className="text-gold">Biết ngay kèo Ngộp</span>
              <br />
              hay Thơm
            </h1>
            <p className="mt-4 text-[16px] md:text-[18px] leading-[1.5] text-slate-300 font-medium max-w-[560px]">
              AI chấm điểm tiềm năng đầu tư BĐS Việt Nam trong 1s. Phát hiện bán gấp, so sánh giá thị trường, đánh
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
                  {extractState.kind === "loading" && (
                    <span className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                  )}
                  <span>📋</span> Dán link tin rao
                </Button>

                <OcrButton onFile={handleOcrFile} disabled={ocrState.busy} />

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

              <div className="mt-3 flex items-start gap-2 text-[11px] text-slate-500">
                <span className="w-1 h-1 rounded-full bg-emerald-500 mt-1" />
                <div>
                  {source === "ai"
                    ? "Chấm điểm bằng AI thật"
                    : "Chấm điểm local • Đăng nhập để dùng AI thật"}
                  {" • "}Q qua{" "}
                  <code className="px-1.5 py-0.5 rounded bg-slate-100 border">/api/check</code>
                </div>
              </div>

              {ocrState.text && (
                <div
                  className={`mt-2 text-[11px] leading-snug ${
                    ocrState.busy
                      ? "text-slate-500"
                      : ocrState.text.startsWith("Đã") || ocrState.text.startsWith("Da")
                        ? "text-emerald-700"
                        : "text-amber-700"
                  }`}
                >
                  {ocrState.text}
                </div>
              )}

              {extractState.text && (
                <div
                  className={`mt-2 text-[11px] leading-snug ${
                    extractState.kind === "error"
                      ? "text-amber-700"
                      : extractState.kind === "ok"
                        ? "text-emerald-700"
                        : "text-slate-500"
                  }`}
                >
                  {extractState.text}
                  {extractState.kind === "error" && (
                    <div className="mt-1 text-slate-500">
                      Cách dùng thay thế: mở tin rao, copy đoạn mô tả (tiêu đề, giá, diện tích, pháp lý) rồi dán
                      vào ô trên.
                    </div>
                  )}
                </div>
              )}
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
          <ResultCard
            result={result}
            source={source}
            analyzedAt={analyzedAt}
            onCheckAnother={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          />
        </section>
      )}
    </>
  );
}
