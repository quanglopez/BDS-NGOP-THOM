"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { runCheck, type CheckSource } from "@/lib/client-check";
import { extractFromUrl, firstUrl, isBareUrl } from "@/lib/client-extract";
import { ocrImageToText } from "@/lib/ocr";
import type { AnalysisResult } from "@/lib/types";
import { ResultCard } from "@/components/site/result-card";
import OcrButton from "@/components/site/ocr-button";
import { CategoryScan } from "@/components/dashboard/category-scan";

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "trang";
  }
}

// Ô check lẻ trong dashboard: dán text / link / ảnh -> AI chấm -> lưu lịch sử.
// Dùng chung runCheck nên đã đăng nhập là gọi /api/check (AI thật + trừ quota),
// xong router.refresh() để stats + lịch sử cập nhật ngay.
export function QuickCheck() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [source, setSource] = useState<CheckSource>("local");
  const [analyzedAt, setAnalyzedAt] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [extractState, setExtractState] = useState<{
    kind: "idle" | "loading" | "ok" | "error";
    text: string;
    reason?: string;
  }>({ kind: "idle", text: "" });
  const [ocrState, setOcrState] = useState<{ busy: boolean; progress: number; text: string }>({
    busy: false,
    progress: 0,
    text: "",
  });
  const [tab, setTab] = useState<"single" | "category">("single");
  const resultRef = useRef<HTMLDivElement>(null);

  const handleCheck = async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      const outcome = await runCheck(text);
      setResult(outcome.result);
      setSource(outcome.source);
      setAnalyzedAt(outcome.analyzedAt);
      // /api/check đã lưu lịch sử + trừ quota -> refresh stats/bảng phía server
      router.refresh();
      setTimeout(
        () => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        100,
      );
    } finally {
      setLoading(false);
    }
  };

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
      setText(clip);
      setExtractState({ kind: "idle", text: "" });
      return;
    }

    setExtractState({ kind: "loading", text: `Đang đọc trang ${safeDomain(url)}...` });
    const r = await extractFromUrl(url);

    if (r.ok) {
      setText(r.text);
      setExtractState({
        kind: "ok",
        text: `Đã lấy nội dung từ ${r.domain} (${r.text.length} ký tự). Kiểm tra rồi bấm Check.`,
      });
      return;
    }

    setText(isBareUrl(clip) ? "" : clip);
    setExtractState({ kind: "error", text: r.message, reason: r.reason });
  };

  const handleOcrFile = async (file: File) => {
    if (ocrState.busy) return;
    if (file.size > 12 * 1024 * 1024) {
      setOcrState({ busy: false, progress: 0, text: "Ảnh quá nặng (vượt 12MB). Hãy chụp lại gọn hơn." });
      return;
    }
    setOcrState({ busy: true, progress: 0, text: "Đang tải bộ nhận dạng tiếng Việt (lần đầu hơi lâu)..." });
    try {
      const t = await ocrImageToText(file, (pct) =>
        setOcrState({ busy: true, progress: pct, text: `Đang đọc chữ trong ảnh... ${pct}%` }),
      );
      setText(t.slice(0, 1000));
      setOcrState({ busy: false, progress: 100, text: `Đã đọc ${t.length} ký tự từ ảnh. Kiểm tra lại rồi bấm Check.` });
    } catch {
      setOcrState({ busy: false, progress: 0, text: "Không đọc được chữ trong ảnh này. Thử ảnh rõ nét hơn, hoặc copy mô tả tin rồi dán vào ô." });
    }
  };

  return (
    <section className="mt-6 rounded-[20px] border border-slate-200 bg-white shadow-[0_16px_50px_-24px_rgba(11,29,58,0.3)] overflow-hidden">
      <div className="p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-black tracking-tight text-navy">Check tin bằng AI</h2>
            <p className="mt-1 text-[12px] text-slate-500">
              Check lẻ 1 tin, hoặc dán link cả trang danh mục để quét nhiều tin rồi chọn.
            </p>
          </div>
          <div className="flex rounded-[10px] bg-cream border border-slate-200 p-1 text-[12px] font-bold">
            <button
              type="button"
              onClick={() => setTab("single")}
              className={`px-4 h-8 rounded-[8px] transition ${tab === "single" ? "bg-navy text-white" : "text-slate-500 hover:text-navy"}`}
            >
              1 tin
            </button>
            <button
              type="button"
              onClick={() => setTab("category")}
              className={`px-4 h-8 rounded-[8px] transition ${tab === "category" ? "bg-navy text-white" : "text-slate-500 hover:text-navy"}`}
            >
              🗂 Danh mục
            </button>
          </div>
        </div>

        {tab === "category" ? (
          <div className="mt-4">
            <CategoryScan />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-end">
              <span className="text-[11px] tabular-nums text-slate-400">{text.length}/1000</span>
            </div>
            <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          placeholder="Bán gấp! Nhà mặt tiền Thùy Vân 80m2, ngân hàng thanh lý, giá 5.5 tỷ, sổ hồng riêng..."
          className="mt-4 w-full min-h-[110px] resize-none rounded-[14px] bg-cream border-slate-200 px-4 py-3 text-[14px] leading-[1.6] placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-navy/15 focus-visible:border-navy/30"
        />

        <div className="mt-4 flex flex-col sm:flex-row gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={handlePaste}
            className="h-[46px] px-4 rounded-[12px] border-slate-200 bg-white hover:bg-slate-50 text-[13px] font-semibold text-slate-700"
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
            className="h-[46px] flex-1 rounded-[12px] bg-gradient-to-r from-navy to-[#16305f] hover:from-[#0e2547] hover:to-[#1a3868] disabled:opacity-50 text-white text-[14px] font-bold"
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

        {(ocrState.text || extractState.text) && (
          <div className="mt-2.5 space-y-1.5">
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
                    <span className="block h-full bg-navy transition-all" style={{ width: `${ocrState.progress}%` }} />
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
                  <div className="mt-2">
                    {["blocked_by_site", "login_required", "no_content", "not_found"].includes(
                      extractState.reason ?? "",
                    ) ? (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <span className="text-slate-500">
                          Cách nhanh nhất: chụp màn hình tin rồi tải ảnh lên, AI tự đọc chữ:
                        </span>
                        <OcrButton onFile={handleOcrFile} disabled={ocrState.busy} compact label="Tải ảnh tin lên" />
                      </div>
                    ) : (
                      <div className="text-slate-500">
                        Cách dùng thay thế: mở tin rao, copy đoạn mô tả rồi dán vào ô trên.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {result && tab === "single" && (
          <div ref={resultRef} className="px-5 md:px-6 pb-5 md:pb-6 scroll-mt-24">
            <ResultCard
              result={result}
              source={source}
              analyzedAt={analyzedAt}
              onCheckAnother={() => setText("")}
            />
          </div>
        )}
          </>
        )}
      </div>
    </section>
  );
}
