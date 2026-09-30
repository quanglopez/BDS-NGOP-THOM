"use client";

import Link from "next/link";
import { trackEvent } from "@/lib/analytics";

const FREE = [
  "20 tin/ngày",
  "Check từng tin",
  "AI scoring 6 tiêu chí",
  "Phân tích cơ bản",
  "Không cần thẻ",
];

const PRO = [
  "500 tin/ngày",
  "Bulk Check 100 tin/lần",
  "Quét cả trang danh mục",
  "Phân tích nâng cao + giải thích điểm",
  "Lọc nhanh tin tiềm năng",
  "Ưu tiên tin điểm cao",
  "Hỗ trợ môi giới chuyên nghiệp",
];

const TRUST = [
  "🔒 Thanh toán an toàn",
  "✓ Hoàn tiền 100% trong 3 ngày",
  "✓ Không tự động gia hạn",
  "✓ Hỗ trợ khách hàng",
];

// Bảng Free vs Pro — CTA thống nhất toàn site: "Dùng miễn phí" / "Nâng cấp PRO"
export function FreeVsPro() {
  return (
    <section id="bang-gia" className="mx-auto max-w-[1120px] scroll-mt-20 px-5 py-12 md:px-8 md:py-16">
      <div className="mx-auto max-w-[640px] text-center">
        <div className="text-micro font-semibold uppercase tracking-[0.09em] text-gold-deep">
          Bảng giá
        </div>
        <h2 className="mt-3 font-display text-h2 text-ink-900">Chọn gói phù hợp với bạn</h2>
        <p className="mt-3 text-lead text-ink-600">
          Không cần thẻ. Không tự động gia hạn. Nâng cấp bất cứ lúc nào.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 items-stretch gap-5 md:grid-cols-2">
        {/* FREE */}
        <div className="flex flex-col rounded-panel border border-line bg-white p-6 md:p-7">
          <div className="text-micro font-bold tracking-widest text-ink-500">FREE</div>
          <div className="mt-3 flex items-baseline gap-2">
            <div className="font-display text-[38px] font-extrabold tabular-nums tracking-tight text-ink-900">
              0đ
            </div>
            <div className="text-small text-ink-600">/ mãi mãi</div>
          </div>
          <ul className="mt-5 flex-1 space-y-2.5">
            {FREE.map((f) => (
              <li key={f} className="flex gap-2.5 text-small text-ink-600">
                <span className="font-bold text-ai-ink">✓</span>
                {f}
              </li>
            ))}
          </ul>
          <Link
            href="#kiem-tra"
            className="mt-6 flex h-[48px] items-center justify-center rounded-md border border-line bg-white text-small font-bold text-ink-700 transition-colors duration-micro ease-cb hover:bg-surface-mist"
          >
            Dùng miễn phí
          </Link>
          <div className="mt-3 text-center text-micro text-ink-500">
            Không cần thẻ • Không cần nhập SĐT
          </div>
        </div>

        {/* PRO */}
        <div className="relative flex flex-col overflow-hidden rounded-panel bg-navy-900 p-6 text-white shadow-navy md:p-7">
          <div className="absolute -right-20 -top-24 h-[300px] w-[300px] rounded-full bg-gold-base/10 blur-[70px]" />
          <div className="relative flex items-center gap-2">
            <div className="text-micro font-bold tracking-widest text-gold-base">PRO</div>
            <span className="rounded-pill bg-gold-base px-2 py-0.5 text-micro font-bold text-navy-900">
              PHỔ BIẾN
            </span>
          </div>
          <div className="relative mt-3 flex items-baseline gap-2">
            <div className="font-display text-[38px] font-extrabold tabular-nums tracking-tight">
              299.000đ
            </div>
            <div className="text-small text-ink-on-navy-muted">/ tháng</div>
          </div>
          <ul className="relative mt-5 flex-1 space-y-2.5">
            {PRO.map((f) => (
              <li key={f} className="flex gap-2.5 text-small text-ink-on-navy">
                <span className="font-bold text-gold-base">✓</span>
                {f}
              </li>
            ))}
          </ul>
          <Link
            href="/pricing"
            onClick={() => trackEvent("upgrade_clicked", { from: "free_vs_pro" })}
            className="relative mt-6 flex h-[48px] items-center justify-center rounded-md bg-gold-base text-small font-bold text-navy-900 transition-colors duration-micro ease-cb hover:bg-gold-soft"
          >
            Nâng cấp PRO
          </Link>
          <div className="relative mt-3 space-y-1 text-center text-micro text-ink-on-navy-muted">
            <div>✓ Hoàn tiền 100% trong 3 ngày nếu không phù hợp</div>
            <div>✓ Có thể hủy bất kỳ lúc nào</div>
          </div>
        </div>
      </div>

      {/* Trust signals */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-micro text-ink-600">
        {TRUST.map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            {t}
          </span>
        ))}
      </div>
    </section>
  );
}
