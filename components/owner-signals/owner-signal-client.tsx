"use client";

import { useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import {
  MAX_LISTING_LENGTH,
  MIN_LISTING_LENGTH,
  classifyOwnerSignals,
  type MatchedSignal,
  type OwnerSignalResult,
} from "@/lib/owner-signals/classify";
import {
  CLASSIFICATION_LABEL,
  CONFLICT_NOTE,
  EVIDENCE_EMPTY_NOTE,
  EVIDENCE_HEADING_BROKER,
  EVIDENCE_HEADING_EMPTY,
  EVIDENCE_HEADING_OWNER,
  EVIDENCE_LEVEL_LABEL,
  LEVEL_EXPLANATION,
  LIMITATION_LIST,
  QUESTIONS_HEADING,
  QUESTIONS_NOTE,
} from "@/lib/owner-signals/wording";

// Tone theo kết quả. KHÔNG dùng đỏ để nói "tin xấu" — công cụ này không phán
// tin tốt/xấu, chỉ nói dấu hiệu nghiêng về hướng nào.
const TONE: Record<OwnerSignalResult["classification"], { ring: string; pill: string }> = {
  broker_like: {
    ring: "border-risk-medium bg-risk-medium-wash text-risk-medium",
    pill: "bg-risk-medium text-white",
  },
  owner_like: {
    ring: "border-ai bg-ai-wash text-ai-ink",
    pill: "bg-ai-ink text-white",
  },
  insufficient: {
    ring: "border-line bg-surface-mist text-ink-600",
    pill: "bg-navy-900 text-white",
  },
};

export function OwnerSignalClient() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<OwnerSignalResult | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const trimmed = text.trim();
  const canAnalyze = trimmed.length >= MIN_LISTING_LENGTH;

  const run = () => {
    const next = classifyOwnerSignals(trimmed);
    if (!next) {
      setHint(`Cần ít nhất ${MIN_LISTING_LENGTH} ký tự nội dung tin để phân tích.`);
      setResult(null);
      return;
    }
    setHint(null);
    setResult(next);
    // Event không kèm nội dung tin / SĐT / câu khớp — chỉ nhãn kết quả thô.
    trackEvent("owner_signal_preview", { result: next.classification });
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-panel border border-line bg-white p-5 shadow-light md:p-6">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="owner-listing" className="text-small font-bold text-ink-900">
            Dán nội dung tin đăng
          </label>
          <span aria-hidden="true" className="text-micro tabular-nums text-ink-500">
            {text.length}/{MAX_LISTING_LENGTH}
          </span>
        </div>
        <p id="owner-listing-hint" className="mt-1 text-micro text-ink-600">
          Toàn bộ mô tả tin: cách xưng hô, lý do bán, các cụm như ký gửi, chính chủ, miễn trung gian.
        </p>

        <textarea
          id="owner-listing"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHint(null);
          }}
          maxLength={MAX_LISTING_LENGTH}
          aria-describedby="owner-listing-hint"
          placeholder="Ví dụ: Bán nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ, sổ hồng riêng, hẻm xe hơi, gia đình cần bán..."
          className="mt-3 h-[150px] w-full resize-none rounded-md border border-line bg-surface-mist px-4 py-3.5 text-body leading-[1.6] text-ink-900 placeholder:text-ink-500 focus-visible:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-light/25"
        />

        <button
          type="button"
          onClick={run}
          disabled={!canAnalyze}
          aria-disabled={!canAnalyze}
          className={`mt-3 flex h-[52px] w-full items-center justify-center rounded-md px-6 text-body font-bold transition-colors duration-micro ease-cb ${
            canAnalyze
              ? "bg-gold-base text-navy-900 hover:bg-gold-soft"
              : "cursor-not-allowed border-2 border-line bg-surface-mist text-ink-500"
          }`}
        >
          {canAnalyze ? "Phân tích dấu hiệu" : `Cần ít nhất ${MIN_LISTING_LENGTH} ký tự`}
        </button>

        <p className="mt-2 text-micro text-ink-500">
          Phân tích chạy ngay trên máy bạn: không gọi AI, không tra cứu số điện thoại, không lưu nội dung tin.
        </p>
        {hint && <p className="mt-2 text-micro font-semibold text-risk-high">{hint}</p>}
      </section>

      <div ref={resultRef} className="scroll-mt-20">
        {result && <ResultPanel result={result} />}
      </div>

      {/* Nhắc lại giới hạn ngay dưới kết quả, không chỉ ở cuối trang. */}
      <section
        className="rounded-panel border border-line bg-surface-mist p-5 md:p-6"
        aria-label="Giới hạn của công cụ"
      >
        <div className="text-[13px] font-black text-navy">Công cụ này làm được gì và không làm được gì</div>
        <ul className="mt-2 space-y-2">
          {LIMITATION_LIST.map((l) => (
            <li key={l} className="flex gap-2 text-micro leading-relaxed text-ink-700">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gold-deep" />
              <span className="min-w-0">{l}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ResultPanel({ result }: { result: OwnerSignalResult }) {
  const tone = TONE[result.classification];
  const showBroker = result.brokerSignals.length > 0;
  const showOwner = result.ownerSignals.length > 0;
  const hasAny = showBroker || showOwner;

  return (
    <section
      className="rounded-panel border border-line bg-white p-5 md:p-6"
      aria-label="Kết quả phân tích dấu hiệu trong tin"
    >
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={`flex h-[92px] w-[92px] shrink-0 items-center justify-center rounded-full border-[6px] ${tone.ring}`}
        >
          <div className="px-1 text-center leading-none">
            <div className="text-[11px] font-black tracking-tight">
              {result.evidenceLevel === "many"
                ? "KHÁ NHIỀU"
                : result.evidenceLevel === "some"
                  ? "MỘT VÀI"
                  : "CHƯA ĐỦ"}
            </div>
            <div className="mt-0.5 text-[9px] font-bold tracking-widest opacity-70">DẤU HIỆU</div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold tracking-[0.18em] text-ink-500">
            DẤU HIỆU TRONG NỘI DUNG TIN
          </div>
          <div
            className={`mt-1 inline-flex max-w-full rounded-pill px-3 py-1 text-[12px] font-black leading-snug ${tone.pill}`}
          >
            {CLASSIFICATION_LABEL[result.classification]}
          </div>
          <div className="mt-2 text-micro font-bold text-ink-600">
            {EVIDENCE_LEVEL_LABEL[result.evidenceLevel]}
          </div>
        </div>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-ink-700">{LEVEL_EXPLANATION[result.evidenceLevel]}</p>
      <p className="mt-2 text-micro leading-relaxed text-ink-600">{result.why}</p>

      {/* Nhắc giới hạn ngay trong kết quả, không chờ xuống cuối trang. */}
      <p className="mt-3 rounded-[12px] border border-gold-base/60 bg-gold-base/10 px-4 py-3 text-micro font-semibold leading-relaxed text-ink-900">
        {LIMITATION_LIST[0]}
      </p>

      {/* Mâu thuẫn: hiện CẢ HAI nhóm, không chọn bên nào. */}
      {result.conflicting && (
        <p className="mt-4 rounded-[12px] border border-risk-medium/30 bg-risk-medium-wash px-4 py-3 text-micro leading-relaxed text-risk-medium">
          {CONFLICT_NOTE}
        </p>
      )}

      {!hasAny && (
        <div className="mt-5">
          <div className="text-[13px] font-black text-navy">{EVIDENCE_HEADING_EMPTY}</div>
          <p className="mt-2 text-micro leading-relaxed text-ink-600">{EVIDENCE_EMPTY_NOTE}</p>
        </div>
      )}

      {showBroker && <SignalGroup heading={EVIDENCE_HEADING_BROKER} signals={result.brokerSignals} />}
      {showOwner && <SignalGroup heading={EVIDENCE_HEADING_OWNER} signals={result.ownerSignals} />}

      <div className="mt-5">
        <div className="text-[13px] font-black text-navy">{QUESTIONS_HEADING}</div>
        <p className="mt-1 text-micro leading-relaxed text-ink-600">{QUESTIONS_NOTE}</p>
        <ol className="mt-2 space-y-2">
          {result.questions.map((q, i) => (
            <li key={q} className="flex gap-2 text-micro leading-relaxed text-ink-700">
              <span className="font-bold tabular-nums text-navy">{i + 1}.</span>
              <span className="min-w-0">{q}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function SignalGroup({ heading, signals }: { heading: string; signals: MatchedSignal[] }) {
  return (
    <div className="mt-5">
      <div className="text-[13px] font-black text-navy">{heading}</div>
      <ul className="mt-2 space-y-3">
        {signals.map((s) => (
          <li key={s.id} className="rounded-[14px] border border-line bg-surface-mist p-4">
            <div className="text-[13px] font-bold text-navy">{s.label}</div>
            <p className="mt-1 text-micro leading-relaxed text-ink-700">
              Trích từ tin: <b>“{s.quote}”</b>
              {s.occurrences > 1 && <span className="text-ink-500"> (nhắc {s.occurrences} lần)</span>}
            </p>
            <p className="mt-1 text-micro leading-relaxed text-ink-600">{s.means}</p>
            {s.strength === "weak" && (
              <p className="mt-1 text-micro font-semibold text-ink-500">
                Mức độ: yếu — không đủ để kết luận.
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
