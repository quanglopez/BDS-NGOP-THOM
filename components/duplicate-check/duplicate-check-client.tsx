"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  MAX_TEXT_LENGTH,
  MIN_TEXT_LENGTH,
  compareDuplicate,
  type DuplicateCheckResult,
} from "@/lib/duplicate-check/compare";
import {
  CHECKLIST_HEADING,
  CROSS_TOOL,
  DIFFERENCE_HEADING,
  DIFFERENCE_NOTE,
  PRICE_HEADING,
  SHARED_EMPTY_NOTE,
  SHARED_HEADING,
  SHARED_NOTE,
} from "@/lib/duplicate-check/wording";

// Tone theo mức — mức cao nghĩa là "nhiều điểm giống", KHÔNG phải "tin tốt"
// hay "đã xác nhận trùng". Không dùng màu thành công/rủi ro cho mức.
const TONE: Record<DuplicateCheckResult["level"], string> = {
  high: "bg-navy text-white",
  medium: "bg-gold-base text-navy-900",
  low: "border border-line bg-surface-mist text-ink-700",
};

export function DuplicateCheckClient() {
  const [textA, setTextA] = useState("");
  const [textB, setTextB] = useState("");
  const [result, setResult] = useState<DuplicateCheckResult | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const trimA = textA.trim();
  const trimB = textB.trim();
  const canRun = trimA.length >= MIN_TEXT_LENGTH && trimB.length >= MIN_TEXT_LENGTH;

  // So sánh chạy HOÀN TOÀN trên máy người dùng: không fetch, không DB,
  // không quota. Nội dung hai tin không rời khỏi trình duyệt.
  const run = () => {
    const next = compareDuplicate({ textA: trimA, textB: trimB });
    if (!next) {
      setHint(`Mỗi tin cần ít nhất ${MIN_TEXT_LENGTH} ký tự nội dung để so sánh.`);
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-3">
          <ListingInput
            id="listing-a"
            label="Tin A"
            value={textA}
            onChange={(v) => {
              setTextA(v);
              setHint(null);
            }}
          />
          <ListingInput
            id="listing-b"
            label="Tin B"
            value={textB}
            onChange={(v) => {
              setTextB(v);
              setHint(null);
            }}
          />
        </div>

        <button
          type="button"
          onClick={run}
          disabled={!canRun}
          aria-disabled={!canRun}
          className={`mt-4 flex h-[52px] w-full items-center justify-center rounded-md px-6 text-body font-bold transition-colors duration-micro ease-cb ${
            canRun
              ? "bg-gold-base text-navy-900 hover:bg-gold-soft"
              : "cursor-not-allowed border-2 border-line bg-surface-mist text-ink-500"
          }`}
        >
          {canRun
            ? "So sánh 2 tin"
            : `Cần ít nhất ${MIN_TEXT_LENGTH} ký tự cho mỗi tin`}
        </button>

        <p className="mt-2 text-micro text-ink-500">
          So sánh chạy ngay trên máy bạn: không gọi AI, không lưu nội dung tin, không tốn lượt nào.
          Điện thoại và link trong tin bị loại khỏi phần so sánh.
        </p>
        {hint && <p className="mt-2 text-micro font-semibold text-risk-high">{hint}</p>}
      </section>

      <div ref={resultRef} className="scroll-mt-20">
        {result && <ResultPanel result={result} />}
      </div>
    </div>
  );
}

function ListingInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-small font-bold text-ink-900">
          {label}
        </label>
        <span aria-hidden="true" className="text-micro tabular-nums text-ink-500">
          {value.length}/{MAX_TEXT_LENGTH}
        </span>
      </div>
      <p id={`${id}-hint`} className="mt-1 text-micro text-ink-600">
        Dán nguyên văn nội dung tin: dự án, vị trí, diện tích, phòng ngủ, giá ghi trong tin.
      </p>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={MAX_TEXT_LENGTH}
        aria-describedby={`${id}-hint`}
        placeholder="Ví dụ: Căn hộ Vinhomes Grand Park 68m2 2 phòng ngủ, view sông, giá 4,8 tỷ..."
        className="mt-2 h-[150px] w-full resize-none rounded-md border border-line bg-surface-mist px-4 py-3.5 text-body leading-[1.6] text-ink-900 placeholder:text-ink-500 focus-visible:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-light/25"
      />
    </div>
  );
}

function ResultPanel({ result }: { result: DuplicateCheckResult }) {
  return (
    <section
      className="rounded-panel border border-line bg-white p-5 md:p-6"
      aria-label="Kết quả so sánh hai tin"
    >
      <div className="text-[10px] font-bold tracking-[0.18em] text-ink-500">
        KẾT QUẢ SO SÁNH THEO CÂU CHỮ
      </div>
      <div className="mt-2">
        <div
          className={`inline-flex max-w-full rounded-pill px-3 py-1 text-[12px] font-black leading-snug ${TONE[result.level]}`}
        >
          {result.levelLabel}
        </div>
      </div>
      <p className="mt-2 text-micro leading-relaxed text-ink-700">{result.explanation}</p>

      {result.banner && (
        <div className="mt-4 rounded-[12px] border border-gold-base/60 bg-gold-base/10 px-4 py-3">
          <div className="text-micro font-black text-ink-900">{result.banner}</div>
          <ul className="mt-2 space-y-2">
            {result.contradictions.map((c) => (
              <li
                key={c.text}
                className="flex gap-2 text-micro leading-relaxed text-ink-700"
              >
                <span
                  aria-hidden="true"
                  className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                    c.severity === "major" ? "bg-risk-medium" : "bg-gold-deep"
                  }`}
                />
                <span className="min-w-0">{c.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-micro leading-relaxed text-ink-600">{DIFFERENCE_NOTE}</p>
        </div>
      )}

      <div className="mt-5">
        <div className="text-[13px] font-black text-navy">{SHARED_HEADING}</div>
        <p className="mt-1 text-micro leading-relaxed text-ink-600">{SHARED_NOTE}</p>
        {result.shared.length === 0 ? (
          <p className="mt-2 text-micro leading-relaxed text-ink-600">{SHARED_EMPTY_NOTE}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {result.shared.map((s) => (
              <li
                key={s.text}
                className="rounded-[14px] border border-line bg-surface-mist px-4 py-3 text-micro leading-relaxed text-ink-700"
              >
                {s.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5">
        <div className="text-[13px] font-black text-navy">{DIFFERENCE_HEADING}</div>
        {result.contradictions.length === 0 ? (
          <p className="mt-2 text-micro leading-relaxed text-ink-600">
            Không thấy thông tin nào ghi khác nhau giữa hai tin.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {result.contradictions.map((c) => (
              <li
                key={`diff-${c.text}`}
                className="flex gap-2 text-micro leading-relaxed text-ink-700"
              >
                <span
                  aria-hidden="true"
                  className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                    c.severity === "major" ? "bg-risk-medium" : "bg-gold-deep"
                  }`}
                />
                <span className="min-w-0">{c.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Giá hiển thị riêng — KHÔNG phải bằng chứng giống, KHÔNG phải mâu thuẫn. */}
      <div className="mt-5">
        <div className="text-[13px] font-black text-navy">{PRICE_HEADING}</div>
        <div className="mt-2 space-y-1.5 rounded-[14px] border border-line bg-surface-mist p-4">
          {result.price.lines.map((line) => (
            <p key={line} className="text-micro leading-relaxed text-ink-700">
              {line}
            </p>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <div className="text-[13px] font-black text-navy">{CHECKLIST_HEADING}</div>
        <ol className="mt-2 space-y-2">
          {result.checklist.map((q, i) => (
            <li key={q} className="flex gap-2 text-micro leading-relaxed text-ink-700">
              <span className="font-bold tabular-nums text-navy">{i + 1}.</span>
              <span className="min-w-0">{q}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Giới hạn năng lực — bắt buộc, ngay trong kết quả. */}
      <p className="mt-5 border-t border-line pt-4 text-micro leading-relaxed text-ink-600">
        {result.limitation}
      </p>

      <div className="mt-5 rounded-[14px] border border-line bg-surface-mist p-4">
        <div className="text-[13px] font-black text-navy">Bước tiếp theo</div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {CROSS_TOOL.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="flex h-12 w-full items-center justify-center rounded-md border border-line bg-white px-4 text-small font-bold text-ink-700 transition-colors duration-micro ease-cb hover:bg-surface-mist sm:w-auto"
            >
              {t.text}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
