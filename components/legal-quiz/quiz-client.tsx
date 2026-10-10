"use client";

import { useMemo, useState } from "react";
import { QUESTIONS, EMPTY_ANSWERS } from "@/lib/legal-quiz/questions";
import {
  legalChecklist,
  scoreLegalQuiz,
  type LegalQuizAnswers,
  type RiskLevel,
} from "@/lib/legal-quiz/scoring";

// Tone rủi ro dùng token có sẵn (không tạo hệ màu mới).
// Nhãn KHÔNG đặt ở đây: nhãn phụ thuộc số cờ (green + còn cờ khác green sạch),
// nên phải lấy từ result.levelLabel để không mâu thuẫn với danh sách bên dưới.
const TONE: Record<RiskLevel, { ring: string; pill: string }> = {
  red: {
    ring: "border-risk-high bg-risk-high-wash text-risk-high",
    pill: "bg-risk-high text-white",
  },
  orange: {
    ring: "border-risk-medium bg-risk-medium-wash text-risk-medium",
    pill: "bg-risk-medium text-white",
  },
  green: {
    ring: "border-ai bg-ai-wash text-ai-ink",
    pill: "bg-ai-ink text-white",
  },
};

export function LegalQuizClient() {
  const [answers, setAnswers] = useState<LegalQuizAnswers>(EMPTY_ANSWERS);
  // Câu đã THỰC SỰ được chạm vào. Không suy từ giá trị: "Chưa rõ" / "Chưa xem"
  // / "Chưa kiểm tra" là câu trả lời hợp lệ, trùng giá trị với default, nên
  // đếm theo value sẽ không phân biệt được "chưa chạm" và "cố ý chọn Chưa rõ".
  const [answeredKeys, setAnsweredKeys] = useState<Set<keyof LegalQuizAnswers>>(
    () => new Set(),
  );
  const [showResult, setShowResult] = useState(false);

  const answeredCount = answeredKeys.size;
  const isComplete = answeredCount === QUESTIONS.length;
  const result = useMemo(() => scoreLegalQuiz(answers), [answers]);
  const checklist = useMemo(() => legalChecklist(), []);

  const choose = (key: keyof LegalQuizAnswers, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }) as LegalQuizAnswers);
    setAnsweredKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      {/* Sticky progress — mobile-first, không modal */}
      <div className="sticky top-16 z-20 -mx-5 border-b border-line bg-cream/95 px-5 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:px-0 md:py-0">
        <div className="flex items-center justify-between gap-3 text-[12px] font-bold text-ink-600">
          <span>12 câu · ~2 phút</span>
          <span className="tabular-nums">{answeredCount}/12</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-navy-600 transition-[width] duration-base ease-cb"
            style={{ width: `${(answeredCount / QUESTIONS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Một câu = một nhóm. Tap target >= 48px. */}
      <div className="space-y-4">
        {QUESTIONS.map((q) => (
          <fieldset
            key={q.key}
            className="rounded-panel border border-line bg-white p-5"
            aria-describedby={q.hint ? `${q.key}-hint` : undefined}
          >
            <legend className="px-1 text-[15px] font-black leading-snug text-navy">
              {q.index}. {q.title}
            </legend>
            {q.hint && (
              <p id={`${q.key}-hint`} className="mt-1 text-[12px] text-ink-600">
                {q.hint}
              </p>
            )}
            <div className="mt-3 grid grid-cols-1 gap-2">
              {q.options.map((opt) => {
                const active = answers[q.key] === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-[12px] border px-4 py-3 text-[13px] font-semibold transition-colors duration-micro ease-cb ${
                      active
                        ? "border-navy-600 bg-navy-600/5 text-navy"
                        : "border-line bg-white text-ink-700 hover:border-navy-600/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name={q.key}
                      value={opt.value}
                      checked={active}
                      // Radio đã checked không bắn onChange khi click lại.
                      // Default "Chưa rõ" đã checked sẵn — phải onClick mới tính là đã trả lời.
                      onClick={() => choose(q.key, opt.value)}
                      onChange={() => choose(q.key, opt.value)}
                      className="h-4 w-4 shrink-0 accent-navy-600"
                    />
                    <span className="min-w-0">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setShowResult(true)}
        disabled={!isComplete}
        aria-disabled={!isComplete}
        className={`flex h-[52px] w-full items-center justify-center gap-2 rounded-md px-7 text-body font-bold shadow-lift transition-colors duration-micro ease-cb ${
          isComplete
            ? "bg-gold-base text-navy-900 hover:bg-gold-soft"
            : "cursor-not-allowed border-2 border-line bg-surface-mist text-ink-500"
        }`}
      >
        {isComplete ? (
          "Xem mức rủi ro pháp lý"
        ) : (
          <>
            {/* Không chỉ dựa vào màu: nói rõ còn thiếu bao nhiêu câu. */}
            Trả lời đủ 12 câu để xem kết quả
            <span className="tabular-nums opacity-70">({answeredCount}/12)</span>
          </>
        )}
      </button>

      {showResult && (
        <section
          className="rounded-panel border border-line bg-white p-5 md:p-6"
          aria-label="Kết quả kiểm tra pháp lý"
        >
          <div className="flex flex-wrap items-center gap-4">
            <div
              className={`flex h-[92px] w-[92px] shrink-0 items-center justify-center rounded-full border-[6px] ${TONE[result.level].ring}`}
            >
              <div className="text-center leading-none">
                <div className="font-display text-[26px] font-extrabold tabular-nums">
                  {result.riskScore}
                </div>
                <div className="mt-0.5 text-[10px] font-bold tracking-widest opacity-70">/100</div>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold tracking-[0.18em] text-ink-500">
                ĐIỂM RỦI RO PHÁP LÝ
              </div>
              <div
                className={`mt-1 inline-flex max-w-full rounded-full px-3 py-1 text-[12px] font-black leading-snug ${TONE[result.level].pill}`}
              >
                {result.levelLabel}
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-700">{result.summary}</p>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-[13px] font-black text-navy">
              Dấu hiệu rủi ro ({result.flags.length})
            </div>
            {result.flags.length === 0 ? (
              <p className="mt-2 text-[13px] leading-relaxed text-ink-600">
                Chưa phát hiện dấu hiệu rủi ro từ các dữ liệu bạn đã nhập.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {result.flags.map((f) => (
                  <li key={f.id} className="rounded-[14px] border border-line bg-surface-mist p-4">
                    <div className="text-[13px] font-bold text-navy">{f.title}</div>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-700">
                      <b>Vì sao:</b> {f.why}
                    </p>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-700">
                      <b>Cách xác minh:</b> {f.verify}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-5">
            <div className="text-[13px] font-black text-navy">Checklist trước khi đặt cọc</div>
            <ol className="mt-2 space-y-2">
              {checklist.map((c, i) => (
                <li key={c} className="flex gap-2 text-[12px] leading-relaxed text-ink-700">
                  <span className="font-bold tabular-nums text-navy">{i + 1}.</span>
                  <span className="min-w-0">{c}</span>
                </li>
              ))}
            </ol>
          </div>

          <p className="mt-5 border-t border-line pt-4 text-[12px] leading-relaxed text-ink-600">
            Kết quả này chỉ dựa trên thông tin bạn tự khai báo, không thay thế việc kiểm tra sổ và quy hoạch thực tế.
          </p>

          <LeadCapture riskScore={result.riskScore} />
        </section>
      )}
    </div>
  );
}

// Lead capture SAU kết quả (không chặn kết quả).
// Chưa có email provider → chỉ lưu vào bảng leads hiện có, không gửi mail.
// Server trả ok-giả khi thiếu cấu hình để UI không vỡ.
function LeadCapture({ riskScore }: { riskScore: number }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("nguoi_mua");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const submit = async () => {
    setStatus("sending");
    setMessage("");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          website,
          planInterest: role,
          source: "legal_quiz",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "Không gửi được, thử lại sau.");
        return;
      }
      setStatus("done");
      setMessage("Đã lưu email. CheckBDS sẽ gửi checklist khi tính năng email sẵn sàng.");
    } catch {
      setStatus("error");
      setMessage("Lỗi mạng, thử lại sau.");
    }
  };

  if (status === "done") {
    return (
      <div className="mt-5 rounded-[14px] border border-ai/40 bg-ai-wash p-4 text-[13px] text-ai-ink">
        {message}
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-[14px] border border-line bg-surface-mist p-4">
      <div className="text-[13px] font-black text-navy">
        Để lại email để nhận checklist khi tính năng email sẵn sàng
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email của bạn"
          className="h-12 w-full rounded-[12px] border border-line bg-white px-4 text-[13px]"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          aria-label="Bạn là ai"
          className="h-12 w-full rounded-[12px] border border-line bg-white px-4 text-[13px]"
        >
          <option value="nguoi_mua">Người mua</option>
          <option value="nha_dau_tu">Nhà đầu tư</option>
          <option value="moi_gioi">Môi giới</option>
        </select>
        <input
          type="text"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          autoComplete="off"
          tabIndex={-1}
          aria-hidden="true"
          className="absolute -left-[9999px] h-px w-px opacity-0"
        />
        <button
          type="button"
          onClick={submit}
          disabled={status === "sending" || !email.includes("@")}
          className="flex h-12 w-full items-center justify-center rounded-[12px] bg-navy-600 px-5 text-[13px] font-bold text-white disabled:opacity-50"
        >
          {status === "sending" ? "Đang lưu..." : "Đăng ký nhận checklist"}
        </button>
        <span className="sr-only">Điểm rủi ro hiện tại: {riskScore}/100</span>
      </div>
      {status === "error" && <p className="mt-2 text-[12px] text-risk-high">{message}</p>}
    </div>
  );
}
