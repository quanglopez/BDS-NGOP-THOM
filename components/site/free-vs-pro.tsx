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
    <section id="bang-gia" className="mx-auto max-w-[1120px] px-5 md:px-8 py-12 md:py-16 scroll-mt-20">
      <div className="text-center max-w-[640px] mx-auto">
        <div className="text-[11px] font-black tracking-[0.2em] uppercase text-[#a5823f]">Bảng giá</div>
        <h2 className="mt-3 text-[24px] md:text-[32px] font-black tracking-tight text-navy">
          Chọn gói phù hợp với bạn
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-slate-500">
          Không cần thẻ. Không tự động gia hạn. Nâng cấp bất cứ lúc nào.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch">
        {/* FREE */}
        <div className="rounded-[20px] border border-slate-200 bg-white p-6 md:p-7 flex flex-col">
          <div className="text-[12px] font-black tracking-widest text-slate-500">FREE</div>
          <div className="mt-3 flex items-baseline gap-2">
            <div className="text-[38px] font-black text-navy">0đ</div>
            <div className="text-[13px] text-slate-500">/ mãi mãi</div>
          </div>
          <ul className="mt-5 space-y-2.5 flex-1">
            {FREE.map((f) => (
              <li key={f} className="flex gap-2.5 text-[13px] text-slate-600">
                <span className="text-emerald-600 font-bold">✓</span>
                {f}
              </li>
            ))}
          </ul>
          <Link
            href="#kiem-tra"
            className="mt-6 h-[48px] rounded-[12px] border border-slate-200 bg-white hover:bg-slate-50 text-[14px] font-bold text-slate-700 flex items-center justify-center transition"
          >
            Dùng miễn phí
          </Link>
          <div className="mt-3 text-[11px] text-center text-slate-400">Không cần thẻ • Không cần nhập SĐT</div>
        </div>

        {/* PRO */}
        <div className="rounded-[20px] bg-navy text-white p-6 md:p-7 flex flex-col relative overflow-hidden shadow-[0_24px_70px_-24px_rgba(11,29,58,0.6)]">
          <div className="absolute -top-24 right-[-80px] w-[300px] h-[300px] bg-gold/15 rounded-full blur-[70px]" />
          <div className="relative flex items-center gap-2">
            <div className="text-[12px] font-black tracking-widest text-gold">PRO</div>
            <span className="px-2 py-0.5 rounded-full bg-gold text-navy text-[10px] font-black">PHỔ BIẾN</span>
          </div>
          <div className="relative mt-3 flex items-baseline gap-2">
            <div className="text-[38px] font-black">299.000đ</div>
            <div className="text-[13px] text-slate-300">/ tháng</div>
          </div>
          <ul className="relative mt-5 space-y-2.5 flex-1">
            {PRO.map((f) => (
              <li key={f} className="flex gap-2.5 text-[13px] text-slate-200">
                <span className="text-gold font-bold">✓</span>
                {f}
              </li>
            ))}
          </ul>
          <Link
            href="/pricing"
            onClick={() => trackEvent("upgrade_clicked", { from: "free_vs_pro" })}
            className="relative mt-6 h-[48px] rounded-[12px] bg-gradient-to-r from-[#C9A86A] to-[#d8ba7f] text-navy text-[14px] font-black flex items-center justify-center hover:from-[#d8ba7f] hover:to-[#e3ca92] transition"
          >
            Nâng cấp PRO
          </Link>
          <div className="relative mt-3 space-y-1 text-[11px] text-slate-300 text-center">
            <div>✓ Hoàn tiền 100% trong 3 ngày nếu không phù hợp</div>
            <div>✓ Có thể hủy bất kỳ lúc nào</div>
          </div>
        </div>
      </div>

      {/* Trust signals */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px] text-slate-500">
        {TRUST.map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            {t}
          </span>
        ))}
      </div>
    </section>
  );
}
