"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics";
import { runCheck } from "@/lib/client-check";
import { reportUrl } from "@/lib/report/slug";
import { savePendingReport, takePendingReport } from "@/lib/pending-report";
import { ScoreRing } from "@/components/site/score-ring";
import {
  AI_QUOTA_NOTE,
  MAX_LISTING_LENGTH,
  MIN_LISTING_LENGTH,
  buildDealGrade,
  quickGrade,
  type DealGrade,
  type SignalTone,
} from "@/lib/deal-grader/preview";
import { classifyAiOutcome, type DealAiState } from "@/lib/deal-grader/ai-outcome";

// Đường dẫn hiện tại — dùng cho `next` khi đá sang login, để quay lại đúng trang.
const SELF_PATH = "/tools/cham-diem-tin-dang";

const TONE_CLASS: Record<SignalTone, string> = {
  green: "border-ai/30 bg-ai-wash text-ai-ink",
  yellow: "border-risk-medium/30 bg-risk-medium-wash text-risk-medium",
  red: "border-risk-high/30 bg-risk-high-wash text-risk-high",
  neutral: "border-line bg-surface-mist text-ink-600",
};

const RING_TONE: Record<SignalTone, "green" | "yellow" | "red"> = {
  green: "green",
  yellow: "yellow",
  red: "red",
  neutral: "yellow",
};

export function DealGraderClient() {
  const [text, setText] = useState("");
  const [grade, setGrade] = useState<DealGrade | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  // null = chưa biết (đang hỏi server). Tránh nhấp nháy sai CTA khi vừa tải trang.
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [aiState, setAiState] = useState<DealAiState | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const trimmed = text.trim();
  const canGrade = trimmed.length >= MIN_LISTING_LENGTH;

  // Biết trạng thái đăng nhập để chọn đúng CTA. Chỉ ĐỌC, không tiêu quota.
  useEffect(() => {
    let alive = true;
    void fetch("/api/payments/status")
      .then((res) => {
        if (alive) setLoggedIn(res.ok);
      })
      .catch(() => {
        if (alive) setLoggedIn(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Quay lại sau login: khôi phục nội dung tin đã dán. CHỈ nhận pending của
  // chính trang này — pending của trang khác thì trả lại, không ăn mất.
  useEffect(() => {
    const pending = takePendingReport();
    if (!pending) return;
    if (pending.returnTo.startsWith(SELF_PATH)) {
      setText(pending.text);
      const restored = quickGrade(pending.text);
      if (restored) setGrade(restored);
    } else {
      savePendingReport(pending);
    }
  }, []);

  const aiReady = useMemo(() => canGrade && !aiLoading, [canGrade, aiLoading]);

  const runQuick = () => {
    const next = quickGrade(trimmed);
    if (!next) {
      setHint(`Cần ít nhất ${MIN_LISTING_LENGTH} ký tự nội dung tin để chấm.`);
      return;
    }
    setHint(null);
    setGrade(next);
    setAiState(null);
    // Sự kiện riêng của Deal Grader. KHÔNG phát lại `property_checked`:
    // runCheck() đã tự phát sự kiện đó ở cả 3 nhánh, phát thêm là đếm trùng.
    trackEvent("deal_grader_preview");
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };

  const handleLoginClick = () => {
    trackEvent("deal_grader_login_click");
    savePendingReport({ text: trimmed, listingUrl: null, returnTo: SELF_PATH });
  };

  const runAi = async () => {
    if (!aiReady) return;
    trackEvent("deal_grader_ai_click");
    setAiLoading(true);
    setHint(null);
    try {
      const outcome = await runCheck(trimmed);
      const state = classifyAiOutcome(outcome);
      setAiState(state);
      if (state.kind === "success") {
        // fromApiResponse đã merge sub-score của AI vào đúng 4 ô breakdown,
        // nên bản AI chỉ là cùng view-model với nguồn "ai" — không có bộ số thứ hai.
        setGrade(
          buildDealGrade({
            result: outcome.result,
            source: "ai",
            confidence: state.confidence,
          }),
        );
        // Chỉ gắn nhãn AI khi server THẬT SỰ trả điểm AI.
        trackEvent("deal_grader_ai_success", { cached: state.cached });
      } else if (state.kind === "auth_required") {
        // Session hết hạn giữa chừng: chuyển CTA về đăng nhập, giữ nguyên bản chấm nhanh.
        setLoggedIn(false);
      }
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-panel border border-line bg-white p-5 shadow-light md:p-6">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="deal-listing" className="text-small font-bold text-ink-900">
            Dán nội dung tin đăng
          </label>
          <span aria-hidden="true" className="text-micro tabular-nums text-ink-500">
            {text.length}/{MAX_LISTING_LENGTH}
          </span>
        </div>
        <p id="deal-listing-hint" className="mt-1 text-micro text-ink-600">
          Toàn bộ mô tả tin: giá, diện tích, giấy tờ, khu vực, lý do bán. Càng đủ chi tiết, điểm càng sát.
        </p>

        <textarea
          id="deal-listing"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHint(null);
          }}
          maxLength={MAX_LISTING_LENGTH}
          aria-describedby="deal-listing-hint"
          placeholder="Bán gấp nhà mặt tiền Thùy Vân 80m2, 4 tầng, ngân hàng thanh lý, giá 5.5 tỷ, sổ hồng riêng, hẻm xe hơi..."
          className="mt-3 h-[150px] w-full resize-none rounded-md border border-line bg-surface-mist px-4 py-3.5 text-body leading-[1.6] text-ink-900 placeholder:text-ink-500 focus-visible:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-light/25"
        />

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={runQuick}
            disabled={!canGrade}
            aria-disabled={!canGrade}
            className={`flex h-[52px] w-full items-center justify-center rounded-md px-6 text-body font-bold transition-colors duration-micro ease-cb sm:w-auto sm:flex-1 ${
              canGrade
                ? "bg-gold-base text-navy-900 hover:bg-gold-soft"
                : "cursor-not-allowed border-2 border-line bg-surface-mist text-ink-500"
            }`}
          >
            {canGrade ? "Chấm nhanh miễn phí" : `Cần ít nhất ${MIN_LISTING_LENGTH} ký tự`}
          </button>
        </div>

        <p className="mt-2 text-micro text-ink-500">
          Chấm nhanh chạy ngay trên máy bạn: không dùng AI, không cần đăng nhập, không tốn lượt nào.
        </p>
        {hint && <p className="mt-2 text-micro font-semibold text-risk-high">{hint}</p>}
      </section>

      <div ref={resultRef} className="scroll-mt-20">
        {grade && <GradePanel grade={grade} />}
      </div>

      {grade && (
        <section
          className="rounded-panel border border-line bg-white p-5 md:p-6"
          aria-label="Chấm bằng AI"
        >
          <div className="text-[15px] font-black text-navy">Chấm sâu hơn bằng AI</div>
          <p className="mt-1 text-micro leading-relaxed text-ink-600">
            AI chấm lại 6 tiêu chí trên cùng nội dung tin, lưu báo cáo để mở lại sau và tính vào lịch sử
            tài khoản. {AI_QUOTA_NOTE}
          </p>

          {aiState?.kind === "quota_exhausted" && (
            <p className="mt-3 rounded-md border border-risk-medium/30 bg-risk-medium-wash px-4 py-3 text-micro font-semibold text-risk-medium">
              {aiState.message}
            </p>
          )}
          {aiState?.kind === "unavailable" && (
            <p className="mt-3 rounded-md border border-line bg-surface-mist px-4 py-3 text-micro font-semibold text-ink-700">
              {aiState.message} Điểm nhanh bên trên vẫn giữ nguyên.
            </p>
          )}

          <div className="mt-4">
            {loggedIn === null && (
              <button
                type="button"
                disabled
                className="flex h-[52px] w-full items-center justify-center rounded-md border-2 border-line bg-surface-mist text-body font-bold text-ink-500"
              >
                Chấm bằng AI
              </button>
            )}

            {loggedIn === true && (
              <button
                type="button"
                onClick={runAi}
                disabled={!aiReady}
                aria-disabled={!aiReady}
                className={`flex h-[52px] w-full items-center justify-center rounded-md px-6 text-body font-bold transition-colors duration-micro ease-cb ${
                  aiReady
                    ? "bg-navy-900 text-white hover:bg-navy-800"
                    : "cursor-not-allowed border-2 border-line bg-surface-mist text-ink-500"
                }`}
              >
                {aiLoading ? "AI đang chấm tin của bạn..." : "Chấm bằng AI"}
              </button>
            )}

            {loggedIn === false && (
              <Link
                href={`/login?next=${encodeURIComponent(SELF_PATH)}`}
                onClick={handleLoginClick}
                className="flex h-[52px] w-full items-center justify-center rounded-md bg-navy-900 px-6 text-center text-small font-bold text-white transition-colors duration-micro ease-cb hover:bg-navy-800"
              >
                Đăng nhập miễn phí để chấm bằng AI + lưu báo cáo
              </Link>
            )}
          </div>

          {aiState?.kind === "success" && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-micro font-semibold text-ai-ink">
                Đã chấm bằng AI{aiState.cached ? " (dùng lại kết quả đã chấm)" : ""}.
              </span>
              {(aiState.checkId || aiState.seoSlug) && (
                <Link
                  href={reportUrl(aiState.checkId ?? "", aiState.seoSlug)}
                  className="flex h-12 items-center rounded-md border border-line bg-white px-4 text-small font-bold text-ink-700 transition-colors duration-micro ease-cb hover:bg-surface-mist"
                >
                  Mở báo cáo đầy đủ →
                </Link>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function GradePanel({ grade }: { grade: DealGrade }) {
  return (
    <section
      className="rounded-panel border border-line bg-white p-5 md:p-6"
      aria-label="Kết quả chấm điểm tin đăng"
    >
      <div className="flex flex-wrap items-center gap-4">
        <ScoreRing score={grade.score} tone={RING_TONE[grade.verdictTone]} caption="/100 ĐIỂM" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold tracking-[0.18em] text-ink-500">{grade.sourceLabel}</div>
          <div
            className={`mt-1 inline-flex max-w-full rounded-pill border px-3 py-1 text-[12px] font-black leading-snug ${TONE_CLASS[grade.verdictTone]}`}
          >
            {grade.verdictLabel}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-micro text-ink-600">
            <span className="rounded-pill border border-line bg-surface-mist px-2.5 py-1 font-semibold">
              {grade.extracted.price}
            </span>
            <span className="rounded-pill border border-line bg-surface-mist px-2.5 py-1 font-semibold">
              {grade.extracted.area}
            </span>
            <span className="rounded-pill bg-gold-base px-2.5 py-1 font-bold text-navy-900">
              {grade.extracted.street}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="text-[13px] font-black text-navy">Tín hiệu chính</div>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {grade.signals.map((s) => (
            <div key={s.key} className={`rounded-[14px] border p-4 ${TONE_CLASS[s.tone]}`}>
              <div className="text-[10px] font-bold tracking-[0.09em] opacity-80">{s.label}</div>
              <div className="mt-1 text-small font-bold">{s.value}</div>
              <div className="mt-1 text-micro leading-snug opacity-90">{s.note}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <div className="text-[13px] font-black text-navy">Vì sao ra điểm này</div>
        <div className="mt-2 space-y-2">
          {grade.reasons.map((r) => (
            <div key={r.label} className="flex items-start gap-3">
              <span
                className={`mt-0.5 w-[52px] shrink-0 text-right text-small font-bold tabular-nums ${
                  r.kind === "plus" ? "text-ai-ink" : r.kind === "minus" ? "text-risk-high" : "text-ink-500"
                }`}
              >
                {r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? `${r.delta}` : "±0"}
              </span>
              <div className="min-w-0">
                <div className="text-small font-bold text-ink-900">{r.label}</div>
                <div className="text-micro leading-snug text-ink-600">{r.note}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <div className="text-[13px] font-black text-navy">Việc nên làm tiếp</div>
        <ol className="mt-2 space-y-2">
          {grade.nextSteps.map((s, i) => (
            <li key={s} className="flex gap-2 text-micro leading-relaxed text-ink-700">
              <span className="font-bold tabular-nums text-navy">{i + 1}.</span>
              <span className="min-w-0">{s}</span>
            </li>
          ))}
        </ol>
      </div>

      <p className="mt-5 border-t border-line pt-4 text-micro leading-relaxed text-ink-600">
        {grade.disclaimer}
      </p>
    </section>
  );
}
