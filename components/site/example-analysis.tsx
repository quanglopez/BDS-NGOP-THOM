"use client";

import Link from "next/link";
import { Check, TriangleAlert } from "lucide-react";
import { ScoreRing } from "@/components/site/score-ring";
import { trackEvent } from "@/lib/analytics";

// Ví dụ phân tích 1 tin — số liệu mẫu để minh hoạ cách chấm điểm, không phải dữ liệu thật.
// Giữ nguyên đúng bộ số liệu cũ. Phần "bị trừ điểm" suy ra trực tiếp từ các
// lý do có delta âm — không thêm lý do, số điểm hay câu chữ nào.
const REASONS = [
  { delta: 18, label: "Giá thấp hơn mặt bằng khu vực", note: "5.5 tỷ cho 80m² ≈ 69tr/m², khu vực quanh 75–85tr/m²" },
  { delta: 16, label: "Sổ hồng riêng, hoàn công đầy đủ", note: "Pháp lý rõ ràng, dễ vay bank và sang tên" },
  { delta: 15, label: "Vị trí mặt tiền biển", note: "Trục Thùy Vân — khu vực có nhu cầu ở thực và khai thác du lịch" },
  { delta: 14, label: "Chủ cần bán nhanh", note: "Xuất hiện từ khóa bán gấp, ngân hàng thanh lý" },
  { delta: 12, label: "Thanh khoản khu vực cao", note: "Mặt tiền — dễ bán lại sau 6–12 tháng" },
  { delta: -8, label: "Hẻm xe hơi, không phải mặt tiền lớn", note: "Kén khách hơn so với mặt tiền đường lớn" },
];

const SCORE = 85;
const TAG = "KÈO NGỘP NGON";
const META = "Nhà mặt tiền Thùy Vân • 80m² • 5,5 tỷ • Vũng Tàu";

const RISKS = REASONS.filter((r) => r.delta < 0);
const STRENGTHS = REASONS.filter((r) => r.delta > 0);

export function ExampleAnalysis() {
  return (
    <section className="mx-auto max-w-[1120px] px-5 py-12 md:px-8 md:py-16">
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-10">
        {/* Nhận định chính + cảnh báo + CTA */}
        <div className="lg:sticky lg:top-24">
          <div className="text-micro font-semibold uppercase tracking-[0.09em] text-gold-deep">
            Báo cáo AI
          </div>
          <h2 className="mt-3 font-display text-h2 text-ink-900">
            Điểm AI không phải con số vô nghĩa
          </h2>
          <p className="mt-3 text-lead text-ink-600">
            Mỗi điểm có lý do. Bạn biết vì sao tin này đáng gọi — để nói chuyện với chủ nhà thuyết phục
            hơn.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-white px-3 py-1.5 text-micro font-semibold text-ink-700">
              <Check size={13} strokeWidth={1.75} aria-hidden="true" className="text-ai-ink" />
              {STRENGTHS.length} điểm cộng có lý do
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-white px-3 py-1.5 text-micro font-semibold text-ink-700">
              <TriangleAlert size={13} strokeWidth={1.75} aria-hidden="true" className="text-risk-medium" />
              {RISKS.length} điểm trừ nêu rõ
            </span>
          </div>

          {RISKS.length > 0 && (
            <div className="mt-5 rounded-lg border border-risk-medium/30 bg-risk-medium-wash p-4">
              <div className="flex items-center gap-2 text-micro font-bold text-risk-medium">
                <TriangleAlert size={15} strokeWidth={1.75} aria-hidden="true" />
                PHẦN BỊ TRỪ ĐIỂM
              </div>
              <ul className="mt-2 space-y-1.5">
                {RISKS.map((r) => (
                  <li key={r.label} className="text-small leading-relaxed text-ink-700">
                    <span className="font-bold tabular-nums text-risk-medium">{r.delta}</span> — {r.label}
                    <span className="text-ink-600">. {r.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Link
            href="#kiem-tra"
            onClick={() => trackEvent("cta_clicked", { cta: "report_preview" })}
            className="mt-6 inline-flex h-[52px] w-full items-center justify-center rounded-md bg-gold-base px-7 text-body font-bold text-navy-900 shadow-lift transition-colors duration-micro ease-cb hover:bg-gold-soft sm:w-auto"
          >
            Dán tin của bạn — xem báo cáo thật
          </Link>
          <p className="mt-2 text-micro text-ink-600">
            Dùng miễn phí – 20 tin/ngày • Không cần thẻ
          </p>
        </div>

        {/* Bản xem trước báo cáo AI — dùng chung ScoreRing với ResultCard */}
        <div className="overflow-hidden rounded-panel border border-line bg-white shadow-navy">
          <div className="flex flex-wrap items-center gap-4 bg-gradient-to-br from-navy-800 via-navy-700 to-navy-900 px-6 py-5">
            <ScoreRing score={SCORE} tone="green" caption="/100" />

            <div className="min-w-0">
              <div className="inline-flex rounded-pill border border-ai-ink bg-ai-ink px-3 py-1 text-micro font-bold tracking-[0.09em] text-white">
                {TAG}
              </div>
              <div className="mt-2 text-small text-ink-on-navy">{META}</div>
            </div>
          </div>

          <div className="p-6">
            <div className="text-small font-display font-bold text-ink-900">
              Tại sao tin này được {SCORE} điểm?
            </div>

            <ul className="mt-4 space-y-3">
              {REASONS.map((r) => (
                <li key={r.label} className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 w-[52px] shrink-0 text-right text-small font-bold tabular-nums ${
                      r.delta > 0 ? "text-ai-ink" : "text-risk-high"
                    }`}
                  >
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                  </span>
                  <div className="min-w-0">
                    <div className="text-small font-bold text-ink-900">{r.label}</div>
                    <div className="text-micro leading-snug text-ink-600">{r.note}</div>
                  </div>
                </li>
              ))}
            </ul>

            <p className="mt-5 border-t border-line pt-4 text-micro text-ink-500">
              Số liệu trong ví dụ là minh hoạ cho cách chấm điểm — kết quả thực tế phụ thuộc nội
              dung tin bạn dán.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}