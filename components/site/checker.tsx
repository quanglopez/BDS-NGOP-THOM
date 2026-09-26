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
        text: "Trình duyệt không cho đọc clipboard. Hãy dán trực tiếp (Ctrl+V) vào ô bên dưới.",
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

  // Ảnh chụp màn hình tin rao (Zalo/Facebook): OCR ngay trong trình duyệt rồi điền vào ô
  const handleOcrFile = async (file: File) => {
    if (ocrState.busy) return;
    if (file.size > 12 * 1024 * 1024) {
      setOcrState({ busy: false, progress: 0, text: "Ảnh quá nặng (vượt 12MB). Hãy chụp lại gọn hơn." });
      return;
    }
    setOcrState({ busy: true, progress: 0, text: "Đang tải bộ nhận dạng tiếng Việt (lần đầu hơi lâu)..." });
    try {
      const text = await ocrImageToText(file, (pct) =>
        setOcrState({ busy: true, progress: pct, text: `Đang đọc chữ trong ảnh... ${pct}%` }),
      );
      setText(text.slice(0, 1000));
      setOcrState({ busy: false, progress: 100, text: `Đã đọc ${text.length} ký tự từ ảnh. Kiểm tra lại rồi bấm Check.` });
    } catch {
      setOcrState({ busy: false, progress: 0, text: "Không đọc được chữ trong ảnh này. Thử ảnh rõ nét hơn, hoặc copy mô tả tin rồi dán vào ô." });
    }
  };

  return (
    <>
      <section className="relative overflow-hidden bg-navy">
        {/* Nền: gradient + lưới mờ + quầng sáng */}
        <div className="absolute inset-0 bg-gradient-to-br from-navy via-[#132A56] to-[#0B1D3A]" />
        <div
          className="absolute inset-0 opacity-[0.13]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse 90% 70% at 50% 0%, black 30%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse 90% 70% at 50% 0%, black 30%, transparent 75%)",
          }}
        />
        <div className="absolute -top-32 right-[-120px] w-[560px] h-[560px] bg-gold/15 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-200px] left-[-140px] w-[520px] h-[520px] bg-blue-600/20 rounded-full blur-[100px]" />

        <div className="relative mx-auto max-w-[1120px] px-5 md:px-8 pt-12 md:pt-20 pb-14 md:pb-20">
          <div className="max-w-[780px]">
            <div className="flex flex-wrap items-center gap-2 mb-5">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gold/15 border border-gold/30 text-[11px] tracking-[0.1em] text-gold font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                MIỄN PHÍ 20 TIN/NGÀY • KHÔNG CẦN THẺ
              </span>
              <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-[11px] tracking-[0.1em] text-slate-200 font-semibold">
                63 TỈNH/THÀNH
              </span>
            </div>
            <h1 className="text-[34px] md:text-[56px] font-black leading-[1.02] tracking-[-0.03em] text-white">
              Dán tin BĐS vào đây,
              <br />
              biết ngay <span className="text-transparent bg-clip-text bg-gradient-to-r from-gold to-[#e8cf9a]">kèo Ngộp</span> hay Thơm
            </h1>
            <p className="mt-4 text-[15px] md:text-[18px] leading-[1.55] text-slate-300 max-w-[600px]">
              AI chấm điểm tiềm năng đầu tư theo <b className="text-white font-semibold">6 tiêu chí</b> —
              phát hiện bán gấp, so sánh giá thị trường, đánh giá pháp lý — trong vài giây.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-slate-400">
              <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Không lưu tin của bạn</span>
              <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Link, ảnh chụp, text đều được</span>
              <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Đăng nhập để dùng AI thật</span>
            </div>
          </div>

          {/* Thẻ nhập tin */}
          <div className="mt-8 md:mt-10 bg-white rounded-[20px] md:rounded-[24px] shadow-[0_24px_90px_-20px_rgba(0,0,0,0.55)] border border-white/40 overflow-hidden max-w-[780px]">
            <div className="p-4 md:p-7">
              <div className="flex items-center justify-between mb-3">
                <label
                  htmlFor="listing"
                  className="text-[12px] font-bold tracking-[0.12em] text-slate-500 uppercase"
                >
                  ① Đưa tin vào — dán text, link hoặc ảnh chụp
                </label>
                <span className="text-[11px] tabular-nums text-slate-400">{text.length}/1000</span>
              </div>

              <Textarea
                id="listing"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1000}
                placeholder="Bán gấp! Nhà mặt tiền Thùy Vân 80m2, 4 tầng, ngân hàng thanh lý, giá 5.5 tỷ (rẻ hơn thị trường 1 tỷ), sổ hồng riêng, hẻm xe hơi..."
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
                    Thử ví dụ {i + 1}: {ex.slice(0, 32)}...
                  </button>
                ))}
              </div>

              <div className="mt-5 flex flex-col sm:flex-row gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePaste}
                  className="h-[50px] px-5 rounded-[12px] border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-[14px] font-semibold text-slate-700"
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
                  className="h-[50px] flex-1 rounded-[12px] bg-gradient-to-r from-navy to-[#16305f] hover:from-[#0e2547] hover:to-[#1a3868] disabled:opacity-50 text-white text-[15px] font-bold shadow-[0_10px_28px_-8px_rgba(11,29,58,0.7)]"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      AI đang chấm...
                    </>
                  ) : (
                    <>
                      <span>🔍</span> ② Check bằng AI
                    </>
                  )}
                </Button>
              </div>

              <div className="mt-3 flex items-start gap-2 text-[11px] text-slate-500">
                <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${source === "ai" ? "bg-emerald-500" : "bg-amber-500"}`} />
                <div>
                  {source === "ai" ? (
                    <>Chấm điểm bằng <b>AI thật</b> • {analyzedAt ? `lúc ${new Date(analyzedAt).toLocaleTimeString("vi-VN")}` : ""}</>
                  ) : (
                    <>Đang chấm bằng <b>công thức dự phòng</b> • <a href="/login" className="text-navy font-semibold underline underline-offset-2">Đăng nhập</a> để dùng AI thật</>
                  )}
                </div>
              </div>

              {(ocrState.text || extractState.text) && (
                <div className="mt-2 space-y-1.5">
                  {ocrState.text && (
                    <div
                      className={`text-[12px] leading-snug rounded-[10px] px-3 py-2 ${
                        ocrState.busy
                          ? "bg-slate-100 text-slate-600"
                          : ocrState.text.startsWith("Đã")
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                            : "bg-amber-50 text-amber-800 border border-amber-200"
                      }`}
                    >
                      {ocrState.busy && (
                        <span className="inline-block w-full h-1 rounded-full bg-slate-200 overflow-hidden mb-1.5">
                          <span
                            className="block h-full bg-navy transition-all"
                            style={{ width: `${ocrState.progress}%` }}
                          />
                        </span>
                      )}
                      {ocrState.text}
                    </div>
                  )}
                  {extractState.text && (
                    <div
                      className={`text-[12px] leading-snug rounded-[10px] px-3 py-2 ${
                        extractState.kind === "error"
                          ? "bg-amber-50 text-amber-800 border border-amber-200"
                          : extractState.kind === "ok"
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                            : "bg-slate-100 text-slate-600"
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
              )}
            </div>

            <div className="px-4 md:px-7 h-[44px] flex items-center justify-between bg-cream border-t border-slate-200 text-[11px]">
              <div className="flex items-center gap-2 text-slate-500">
                <span>🛡️ Tin chỉ dùng để chấm điểm, không chia sẻ</span>
              </div>
              <a href="/pricing" className="font-semibold text-navy hover:underline">
                Cần check số lượng lớn? Xem gói Pro →
              </a>
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
