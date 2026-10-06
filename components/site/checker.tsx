"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { exampleListings } from "@/lib/market-data";
import { runCheck, fetchQuota, type CheckSource } from "@/lib/client-check";
import { extractFromUrl, firstUrl, isBareUrl } from "@/lib/client-extract";
import { parseCategoryUrl } from "@/lib/category-slug";
import { takePendingReport } from "@/lib/pending-report";
import type { AnalysisResult } from "@/lib/types";
import { trackEvent } from "@/lib/analytics";
import { ResultCard } from "@/components/site/result-card";
import { CategoryScan } from "@/components/dashboard/category-scan";
import { Search, ShieldCheck, Zap } from "lucide-react";

type Status = {
  kind: "idle" | "loading" | "ok" | "error" | "limit";
  text: string;
  reason?: string;
};

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
  const [typed, setTyped] = useState(false);
  // Plan + check id để ResultCard hiển thị đúng CTA (Pro: mở report sâu / Free: mở khóa)
  const [isPro, setIsPro] = useState(false);
  const [checkId, setCheckId] = useState<string | null>(null);
  const [seoSlug, setSeoSlug] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Biết plan 1 lần khi mount (null khi chưa login -> coi như Free, không gọi AI)
  useEffect(() => {
    let alive = true;
    void fetchQuota().then((q) => {
      if (alive && q) setIsPro(q.plan !== "free");
    });
    return () => {
      alive = false;
    };
  }, []);

  // Sau login quay lại: nếu có report đang dở (đã lưu trước khi đá sang login)
  // thì tự chạy lại với session thật, khách không phải nhập lại
  useEffect(() => {
    const pending = takePendingReport();
    if (!pending) return;
    const url = isBareUrl(pending.text.trim()) ? pending.text.trim() : firstUrl(pending.text);
    setText(pending.text);
    if (url) void checkUrl(url);
    else void checkText(pending.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkUrl = async (url: string) => {
    setCategoryUrl(null);
    setStatus({ kind: "loading", text: "Đang lấy nội dung tin từ link..." });
    const r = await extractFromUrl(url);
    if (!r.ok) {
      setStatus({ kind: "error", text: r.message, reason: r.reason });
      return;
    }
    setText(r.text);
    await doCheck(r.text, url);
  };

  const checkText = async (raw: string) => {
    setCategoryUrl(null);
    await doCheck(raw.trim());
  };

  const doCheck = async (payload: string, listingUrl?: string | null) => {
    setLoading(true);
    setStatus({ kind: "loading", text: "AI đang phân tích tin của bạn..." });
    try {
      const outcome = await runCheck(payload, { listingUrl: listingUrl ?? null });

      // Hết lượt: nói rõ, không trả kết quả dự phòng như thể vẫn còn lượt
      if (outcome.quotaExhausted) {
        setResult(null);
        setStatus({ kind: "limit", text: outcome.serverError ?? "Bạn đã hết lượt check hôm nay." });
        return;
      }

      setResult(outcome.result);
      setSource(outcome.source);
      setAnalyzedAt(outcome.analyzedAt);
      setAuthRequired(Boolean(outcome.authRequired));
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
    }
  };

  const handleCheck = async (rawInput?: string) => {
    const raw = (rawInput ?? text).trim();
    if (!raw || loading) return;
    setText(raw);

    // 1) Link danh mục Chợ Tốt/Nhà Tốt -> quét danh sách nhiều tin
    const url = isBareUrl(raw) ? raw : firstUrl(raw);
    if (url && parseCategoryUrl(url)) {
      setCategoryUrl(url);
      setResult(null);
      setStatus({ kind: "idle", text: "" });
      trackEvent("cta_clicked", { cta: "check_category_link" });
      return;
    }

    // 2) Link 1 tin -> lấy nội dung trang rồi chấm
    if (url) {
      trackEvent("cta_clicked", { cta: "check_listing_link" });
      await checkUrl(url);
      return;
    }

    // 3) Văn bản thuần -> chấm thẳng
    setCategoryUrl(null);
    trackEvent("cta_clicked", { cta: "check_text" });
    await checkText(raw);
  };

  const resetToInput = () => {
    setCategoryUrl(null);
    setResult(null);
    setText("");
    setAuthRequired(false);
    setCheckId(null);
    setSeoSlug(null);
    setStatus({ kind: "idle", text: "" });
    document.getElementById("kiem-tra")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Nút ví dụ: điền VÀ chạy phân tích luôn, để người mới xem được
  // giá trị thật sau 1 chạm, không phải 2.
  const runExample = (i: number) => {
    trackEvent("demo_started", { from: "example", index: i + 1 });
    void handleCheck(exampleListings[i]);
  };

  return (
    <>
      <div id="kiem-tra" className="scroll-mt-20 mx-auto max-w-[1120px] px-5 md:px-8 relative z-10 -mt-10 md:-mt-14">
        <div className="max-w-[780px] overflow-hidden rounded-panel border border-line bg-white shadow-navy">
          <div className="p-4 md:p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <label htmlFor="listing" className="text-small font-semibold text-ink-700">
                Dán mô tả tin, link tin hoặc link danh mục
              </label>
              <span aria-hidden="true" className="text-micro tabular-nums text-ink-500">
                {text.length}/1000
              </span>
            </div>

            <Textarea
              id="listing"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                // Chỉ ghi nhận lần gõ đầu tiên để đo mức rớt ở bước 1
                if (!typed && e.target.value.trim()) {
                  setTyped(true);
                  trackEvent("input_started", { from: "listing_textarea" });
                }
              }}
              maxLength={1000}
              aria-required="true"
              aria-describedby="check-hint check-status"
              placeholder="Bán gấp! Nhà mặt tiền Thùy Vân 80m2, 4 tầng, ngân hàng thanh lý, giá 5.5 tỷ, sổ hồng riêng, hẻm xe hơi... (hoặc dán link tin / link danh mục)"
              className="w-full min-h-[132px] resize-none rounded-md border-line bg-surface-mist px-4 py-3.5 text-body leading-[1.6] text-ink-900 placeholder:text-ink-500 focus-visible:border-line-strong focus-visible:ring-2 focus-visible:ring-focus-light/25 focus-visible:ring-offset-0"
            />

            {/* Ví dụ: nút thật, bấm là ra kết quả luôn */}
            <div className="mt-3.5">
              <div id="check-hint" className="text-micro font-medium text-ink-600">
                Chưa có tin? Thử miễn phí với tin mẫu — bấm là có kết quả ngay:
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {exampleListings.map((ex, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => runExample(i)}
                    disabled={loading}
                    aria-label={`Chạy phân tích bằng tin mẫu ${i + 1}`}
                    className="inline-flex h-12 items-center gap-1.5 rounded-sm border-2 border-navy-600/25 bg-white px-4 text-small font-bold text-navy transition-colors duration-micro ease-cb hover:border-navy-600 hover:bg-navy-600 hover:text-white disabled:opacity-50"
                  >
                    <Zap size={14} strokeWidth={1.75} aria-hidden="true" />
                    Thử mẫu {i + 1}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <Button
                type="button"
                onClick={() => void handleCheck()}
                disabled={!text.trim() || loading}
                aria-busy={loading}
                className="h-[52px] w-full rounded-md bg-gold-base text-body font-bold text-navy-900 shadow-lift transition-colors duration-micro ease-cb hover:bg-gold-soft disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin rounded-full border-2 border-navy-900/30 border-t-navy-900"
                    />
                    AI đang phân tích...
                  </>
                ) : (
                  <>
                    <Search size={18} strokeWidth={1.75} aria-hidden="true" />
                    Check bằng AI
                  </>
                )}
              </Button>
            </div>

            {status.text && (
              <div
                id="check-status"
                role="status"
                aria-live="polite"
                className={`mt-3 rounded-sm border px-3 py-2 text-small leading-snug ${
                  status.kind === "limit"
                    ? "border-risk-medium/30 bg-risk-medium-wash text-risk-medium"
                    : status.kind === "error"
                      ? "border-risk-high/30 bg-risk-high-wash text-risk-high"
                      : "border-line bg-surface-mist text-ink-600"
                }`}
              >
                {status.text}
                {status.kind === "limit" ? (
                  <div className="mt-2">
                    <Link
                      href="/pricing#thanh-toan"
                      onClick={() => trackEvent("upgrade_clicked", { from: "limit_banner" })}
                      className="inline-flex h-11 items-center rounded-sm bg-navy-900 px-4 text-small font-bold text-white transition-colors duration-micro ease-cb hover:bg-navy-800"
                    >
                      Nâng cấp PRO →
                    </Link>
                  </div>
                ) : (
                  status.kind === "error" && (
                    <div className="mt-1 text-ink-600">
                      Cách thay thế: mở tin rao, copy đoạn mô tả (tiêu đề, giá, diện tích, pháp lý) rồi dán vào ô trên.
                    </div>
                  )
                )}
              </div>
            )}

            {categoryUrl && (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-small font-semibold text-ink-700">Đang quét danh mục</div>
                  <button
                    type="button"
                    onClick={resetToInput}
                    className="inline-flex h-11 shrink-0 items-center text-small font-bold text-navy underline-offset-2 transition-colors duration-micro ease-cb hover:underline"
                  >
                    ← Check tin khác
                  </button>
                </div>
                <CategoryScan url={categoryUrl} />
              </div>
            )}
          </div>

          <div className="flex min-h-[44px] flex-col gap-1 border-t border-line bg-surface-mist px-4 py-2.5 text-micro text-ink-600 sm:flex-row sm:items-center sm:justify-between md:px-6">
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
              <span>Tin chỉ dùng để chấm điểm, không chia sẻ</span>
            </div>
            <a
              href="/pricing"
              className="inline-flex min-h-[44px] shrink-0 items-center font-semibold text-navy underline-offset-2 transition-colors duration-micro ease-cb hover:underline"
            >
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
            isPro={isPro}
            checkId={checkId}
            seoSlug={seoSlug}
            pendingText={text}
            pendingListingUrl={(() => {
              const raw = text.trim();
              const u = isBareUrl(raw) ? raw : firstUrl(raw);
              return u ?? null;
            })()}
            onCheckAnother={resetToInput}
          />
        </section>
      )}
    </>
  );
}
