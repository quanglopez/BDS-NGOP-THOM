"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  MAX_LISTING_LENGTH,
  MIN_LISTING_LENGTH,
  checkUrgency,
  type UrgencyCheckResult,
} from "@/lib/urgency-check/classify";
import {
  CHECKLIST_HEADING,
  CHECKLIST_NOTE,
  EVIDENCE_HEADING,
  GRADER_HANDOFF_CTA,
  GRADER_HANDOFF_HREF,
  GRADER_HANDOFF_TEXT,
  LEGAL_HANDOFF_CTA,
  LEGAL_HANDOFF_HREF,
  LEGAL_HANDOFF_TEXT,
  NO_EVIDENCE_NOTE,
  OWNER_ASK,
  PHYSICAL_HEADING,
  URGENCY_NOT_QUALITY,
  WATCH_HEADING,
} from "@/lib/urgency-check/wording";

// Tone theo mức. KHÔNG dùng màu "tốt" cho verify_soon — dấu hiệu cần xác minh
// không phải tin tốt.
const TONE: Record<UrgencyCheckResult["level"], { ring: string; pill: string }> = {
  verify_soon: {
    ring: "border-risk-medium bg-risk-medium-wash text-risk-medium",
    pill: "bg-risk-medium text-white",
  },
  insufficient: {
    ring: "border-line bg-surface-mist text-ink-600",
    pill: "bg-navy-900 text-white",
  },
};

export function UrgencyCheckClient() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<UrgencyCheckResult | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const trimmed = text.trim();
  const canRun = trimmed.length >= MIN_LISTING_LENGTH;

  // Phân tích chạy HOÀN TOÀN trên máy người dùng: không fetch, không DB,
  // không quota. Nội dung tin không rời khỏi trình duyệt.
  const run = () => {
    const next = checkUrgency({ text: trimmed });
    if (!next) {
      setHint(`Cần ít nhất ${MIN_LISTING_LENGTH} ký tự nội dung tin để kiểm tra.`);
      setResult(null);
      return;
    }
    setHint(null);
    setResult(next);
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-panel border border-line bg-white p-5 shadow-light md:p-6">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="urgency-listing" className="text-small font-bold text-ink-900">
            Dán nội dung tin đăng
          </label>
          <span aria-hidden="true" className="text-micro tabular-nums text-ink-500">
            {text.length}/{MAX_LISTING_LENGTH}
          </span>
        </div>
        <p id="urgency-listing-hint" className="mt-1 text-micro text-ink-600">
          Toàn bộ mô tả tin: lý do bán, các cụm như bán gấp, cắt lỗ, ngộp, giảm giá, thời hạn bán.
        </p>

        <textarea
          id="urgency-listing"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHint(null);
          }}
          maxLength={MAX_LISTING_LENGTH}
          aria-describedby="urgency-listing-hint"
          placeholder="Ví dụ: Bán gấp nhà 70m2 tại Đà Nẵng, giá 3.5 tỷ, sổ hồng riêng, cần bán trong tháng..."
          className="mt-3 h-[150px] w-full resize-none rounded-md border border-line bg-surface-mist px-4 py-3.5 text-body leading-[1.6] text-ink-900 placeholder:text-ink-500 focus-visible:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-light/25"
        />

        <button
          type="button"
          onClick={run}
          disabled={!canRun}
          aria-disabled={!canRun}
          className={`mt-3 flex h-[52px] w-full items-center justify-center rounded-md px-6 text-body font-bold transition-colors duration-micro ease-cb ${
            canRun
              ? "bg-gold-base text-navy-900 hover:bg-gold-soft"
              : "cursor-not-allowed border-2 border-line bg-surface-mist text-ink-500"
          }`}
        >
          {canRun ? "Kiểm tra dấu hiệu" : `Cần ít nhất ${MIN_LISTING_LENGTH} ký tự`}
        </button>

        <p className="mt-2 text-micro text-ink-500">
          Phân tích chạy ngay trên máy bạn: không gọi AI, không lưu nội dung tin, không tốn lượt nào.
        </p>
        {hint && <p className="mt-2 text-micro font-semibold text-risk-high">{hint}</p>}
      </section>

      <div ref={resultRef} className="scroll-mt-20">
        {result && <ResultPanel result={result} />}
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: UrgencyCheckResult }) {
  const tone = TONE[result.level];

  return (
    <section
      className="rounded-panel border border-line bg-white p-5 md:p-6"
      aria-label="Kết quả kiểm tra dấu hiệu bán gấp"
    >
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={`flex h-[92px] w-[92px] shrink-0 items-center justify-center rounded-full border-[6px] px-1 text-center ${tone.ring}`}
        >
          <div className="leading-none">
            <div className="text-[11px] font-black tracking-tight">
              {result.level === "verify_soon" ? "XÁC MINH SỚM" : "CHƯA ĐỦ"}
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
            {result.levelLabel}
          </div>
          <p className="mt-2 text-micro leading-relaxed text-ink-700">{result.explanation}</p>
        </div>
      </div>

      {/* Tín hiệu gấp KHÔNG phải chất lượng đầu tư — nói rõ ngay trên kết quả. */}
      <p className="mt-3 rounded-[12px] border border-gold-base/60 bg-gold-base/10 px-4 py-3 text-micro font-semibold leading-relaxed text-ink-900">
        {URGENCY_NOT_QUALITY}
      </p>

      {result.contextNote && (
        <p className="mt-2 text-micro leading-relaxed text-ink-600">{result.contextNote}</p>
      )}

      <div className="mt-5">
        <div className="text-[13px] font-black text-navy">{EVIDENCE_HEADING}</div>
        {result.evidence.length === 0 ? (
          <p className="mt-2 text-micro leading-relaxed text-ink-600">{NO_EVIDENCE_NOTE}</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {result.evidence.map((e) => (
              <li
                key={`${e.signalId}-${e.start}`}
                className="min-w-0 rounded-[14px] border border-line bg-surface-mist p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-navy px-2.5 py-1 text-[11px] font-bold text-white">
                    {e.tier === "strong" ? "Mạnh" : "Trung bình"}
                  </span>
                  <span className="text-[12px] font-bold text-navy">{e.label}</span>
                </div>
                <p className="mt-2 break-words text-micro leading-relaxed text-ink-700">
                  Trích từ tin: <b>“{e.quote}”</b>
                </p>
                <p className="mt-1 text-micro leading-relaxed text-ink-600">{e.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5">
        <div className="text-[13px] font-black text-navy">{CHECKLIST_HEADING}</div>
        <p className="mt-1 text-micro leading-relaxed text-ink-600">{CHECKLIST_NOTE}</p>
        <ol className="mt-2 space-y-2">
          {result.questions.map((q, i) => (
            <li key={q} className="flex gap-2 text-micro leading-relaxed text-ink-700">
              <span className="font-bold tabular-nums text-navy">{i + 1}.</span>
              <span className="min-w-0">{q}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-5">
        <div className="text-[13px] font-black text-navy">{WATCH_HEADING}</div>
        <ul className="mt-2 space-y-2">
          {result.watchFor.map((w) => (
            <li key={w} className="flex gap-2 text-micro leading-relaxed text-ink-700">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-risk-medium" />
              <span className="min-w-0">{w}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5">
        <div className="text-[13px] font-black text-navy">{PHYSICAL_HEADING}</div>
        <ul className="mt-2 space-y-2">
          {result.physicalChecks.map((c) => (
            <li key={c} className="flex gap-2 text-micro leading-relaxed text-ink-700">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gold-deep" />
              <span className="min-w-0">{c}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-micro leading-relaxed text-ink-600">{OWNER_ASK}</p>
      </div>

      {/* Giới hạn năng lực — bắt buộc, ngay trong kết quả. */}
      <p className="mt-5 border-t border-line pt-4 text-micro leading-relaxed text-ink-600">
        {result.limitation}
      </p>

      <div className="mt-5 rounded-[14px] border border-line bg-surface-mist p-4">
        <div className="text-[13px] font-black text-navy">Bước tiếp theo</div>
        <p className="mt-1 text-micro leading-relaxed text-ink-600">{LEGAL_HANDOFF_TEXT}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link
            href={LEGAL_HANDOFF_HREF}
            className="flex h-12 w-full items-center justify-center rounded-md bg-navy-900 px-4 text-small font-bold text-white transition-colors duration-micro ease-cb hover:bg-navy-800 sm:w-auto"
          >
            {LEGAL_HANDOFF_CTA}
          </Link>
          <Link
            href={GRADER_HANDOFF_HREF}
            className="flex h-12 w-full items-center justify-center rounded-md border border-line bg-white px-4 text-small font-bold text-ink-700 transition-colors duration-micro ease-cb hover:bg-surface-mist sm:w-auto"
          >
            {GRADER_HANDOFF_CTA}
          </Link>
        </div>
        <p className="mt-2 text-micro leading-relaxed text-ink-600">{GRADER_HANDOFF_TEXT}</p>
      </div>
    </section>
  );
}
