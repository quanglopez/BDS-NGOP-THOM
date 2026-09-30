"use client";

import { trackEvent } from "@/lib/analytics";

// Hero: lợi ích thực tế cho môi giới + CTA chính duy nhất.
// Giữ nguyên wording CTA, id neo (#kiem-tra / #demo) và tên sự kiện đo lường —
// đổi một trong ba là mất dữ liệu phễu hoặc gãy liên kết.
export function Hero() {
  return (
    <section className="relative overflow-hidden bg-navy-900">
      <div className="absolute inset-0 bg-gradient-to-br from-navy-800 via-navy-700 to-navy-900" />
      <div
        className="absolute inset-0 opacity-[0.13]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 90% 70% at 50% 0%, black 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 70% at 50% 0%, black 30%, transparent 75%)",
        }}
      />
      <div className="absolute -top-32 right-[-120px] h-[560px] w-[560px] rounded-full bg-gold-base/10 blur-[100px]" />
      <div className="absolute bottom-[-200px] left-[-140px] h-[520px] w-[520px] rounded-full bg-navy-600/40 blur-[100px]" />

      <div className="relative mx-auto max-w-[1120px] px-5 pb-8 pt-12 md:px-8 md:pt-16">
        <div className="max-w-[720px]">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-micro font-semibold tracking-[0.09em] text-slate-200">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-base" />
            CHO MÔI GIỚI BẤT ĐỘNG SẢN • 63 TỈNH/THÀNH
          </div>

          <h1 className="font-display text-display text-white">
            Lọc 100 tin BĐS
            <br />
            trong{" "}
            <span className="bg-gradient-to-r from-gold-base to-gold-soft bg-clip-text text-transparent">
              1 phút
            </span>
          </h1>

          <p className="mt-4 font-display text-h3 font-bold text-slate-100">
            Biết tin nào đáng gọi chủ nhà trước.
          </p>

          <p className="mt-3 max-w-[620px] text-body leading-[1.6] text-slate-300">
            Dán link Nhà Tốt/Chợ Tốt hoặc nội dung tin rao. CheckBDS tự động phân tích{" "}
            <b className="font-semibold text-white">giá, vị trí, pháp lý, thanh khoản</b> và{" "}
            <b className="font-semibold text-white">dấu hiệu bán gấp</b> để giúp bạn ưu tiên những tin đáng gọi nhất.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="#kiem-tra"
              onClick={() => trackEvent("cta_clicked", { cta: "hero_primary" })}
              className="flex h-[52px] items-center justify-center rounded-md bg-gold-base px-8 text-[15px] font-bold text-navy-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_30px_-8px_rgba(216,180,106,0.5)] transition-colors duration-micro ease-cb hover:bg-gold-soft"
            >
              Dùng miễn phí – 20 tin/ngày
            </a>
            <a
              href="#demo"
              onClick={() => trackEvent("demo_started", { from: "hero_cta" })}
              className="flex h-[52px] items-center justify-center rounded-md border border-line-navy-strong px-7 text-[15px] font-semibold text-white transition-colors duration-micro ease-cb hover:bg-white/10"
            >
              Xem demo
            </a>
          </div>

          <p className="mt-3 text-small text-slate-400">
            Không cần thẻ • Đăng nhập Google trong 10 giây • Quét 100 tin/lần là tính năng PRO
          </p>
        </div>
      </div>
    </section>
  );
}
