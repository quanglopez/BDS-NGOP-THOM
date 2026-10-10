"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

// Hero: lợi ích thực tế cho môi giới + CTA chính duy nhất.
// Giữ nguyên wording CTA, id neo (#kiem-tra / #demo) và tên sự kiện đo lường —
// đổi một trong ba là mất dữ liệu phễu hoặc gãy liên kết.
const YOUTUBE_INTRO_ID = "C14TG2CZxDQ";

export function Hero() {
  const [playing, setPlaying] = useState(false);

  const start = () => {
    setPlaying(true);
    trackEvent("demo_started", { from: "hero_video" });
  };
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
            Biết tin nào đáng gọi trước khi mất thời gian gọi.
          </h1>
          <p className="mt-4 inline-flex max-w-full items-center rounded-full border border-gold-base/40 bg-gold-base/10 px-3 py-1 text-[12px] font-bold leading-snug text-gold-base">
            PRO: Lọc 100 tin BĐS trong 1 phút
          </p>
          <p className="mt-2 text-[12px] font-semibold text-slate-300">
            Tính năng PRO — Bulk Check và quét cả trang danh mục
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
              className="flex h-[52px] items-center justify-center rounded-md bg-gold-base px-8 text-body font-bold text-navy-900 shadow-lift transition-colors duration-micro ease-cb hover:bg-gold-soft"
            >
              Dùng miễn phí – 20 tin/ngày
            </a>
            <a
              href="#demo"
              onClick={() => trackEvent("demo_started", { from: "hero_cta" })}
              className="flex h-[52px] items-center justify-center rounded-md border border-line-navy-strong px-7 text-body font-semibold text-white transition-colors duration-micro ease-cb hover:bg-white/10"
            >
              Xem demo
            </a>
          </div>

          <p className="mt-3 text-small text-slate-400">
            Không cần thẻ • Đăng nhập Google trong 10 giây • Quét 100 tin/lần là tính năng PRO
          </p>

          <div className="mt-8 overflow-hidden rounded-panel border border-white/15 bg-navy-800/60 shadow-navy">
            <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
              {playing ? (
                <iframe
                  src={`https://www.youtube.com/embed/${YOUTUBE_INTRO_ID}?autoplay=1&rel=0`}
                  title="Giới thiệu CheckBDS.online"
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                  allowFullScreen
                  className="absolute inset-0 h-full w-full border-0"
                />
              ) : (
                <button
                  type="button"
                  onClick={start}
                  aria-label="Phát video giới thiệu CheckBDS"
                  className="group absolute inset-0 flex items-center justify-center overflow-hidden bg-navy-900"
                  style={{
                    backgroundImage:
                      "url(https://i.ytimg.com/vi/C14TG2CZxDQ/maxresdefault.jpg)",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                >
                  <span className="absolute inset-0 bg-navy-900/45 transition-colors duration-micro ease-cb group-hover:bg-navy-900/35" />
                  <span className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full bg-gold-base shadow-lift transition-transform duration-micro ease-cb group-hover:scale-105">
                    <Play size={26} strokeWidth={1.75} aria-hidden="true" className="translate-x-[2px] fill-navy-900 text-navy-900" />
                  </span>
                  <span className="sr-only">Phát video giới thiệu CheckBDS</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
