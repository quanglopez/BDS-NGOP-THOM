"use client";

import { useState } from "react";
import { trackEvent } from "@/lib/analytics";

// Video hướng dẫn sử dụng (Loom) — đặt tại vị trí Demo mà nút "Xem demo" trên hero trỏ tới.
// Dạng facade: chỉ tải iframe khi khách bấm Play, để LCP mobile vẫn nhanh
// (không tải JS/video của bên thứ ba trước khi khách thật sự muốn xem).
const LOOM_ID = "4bb232033a78467e99fcd3b12ec6a8cd";

export function ProductDemo() {
  const [playing, setPlaying] = useState(false);

  const start = () => {
    setPlaying(true);
    trackEvent("demo_started", { from: "video" });
  };

  return (
    <section id="demo" className="mx-auto max-w-[1120px] px-5 md:px-8 py-12 md:py-16 scroll-mt-20">
      <div className="text-center max-w-[640px] mx-auto">
        <div className="text-[11px] font-black tracking-[0.2em] uppercase text-[#a5823f]">Xem demo</div>
        <h2 className="mt-3 text-[24px] md:text-[32px] font-black tracking-tight text-navy">
          Xem thao tác trong 2 phút
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-slate-500">
          Xem cách dán tin, quét danh mục và lọc ra những kèo đáng gọi trước — không cần đọc tài liệu.
        </p>
      </div>

      <div className="mt-8 mx-auto max-w-[880px]">
        <div className="relative rounded-[20px] overflow-hidden border border-slate-200 bg-navy shadow-[0_24px_70px_-30px_rgba(11,29,58,0.5)]">
          {/* Tỉ lệ 16:9 để không bị lệch layout trước khi iframe tải */}
          <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
            {playing ? (
              <iframe
                src={`https://www.loom.com/embed/${LOOM_ID}?autoplay=1`}
                title="Video hướng dẫn sử dụng CheckBDS"
                allow="autoplay; fullscreen"
                allowFullScreen
                className="absolute inset-0 h-full w-full border-0"
              />
            ) : (
              <button
                type="button"
                onClick={start}
                aria-label="Phát video hướng dẫn sử dụng"
                className="absolute inset-0 group flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-navy via-[#132A56] to-[#0B1D3A]"
              >
                <div
                  className="absolute inset-0 opacity-[0.13]"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
                    backgroundSize: "44px 44px",
                    maskImage: "radial-gradient(ellipse 80% 70% at 50% 50%, black 30%, transparent 75%)",
                    WebkitMaskImage:
                      "radial-gradient(ellipse 80% 70% at 50% 50%, black 30%, transparent 75%)",
                  }}
                />
                <span className="relative w-[72px] h-[72px] rounded-full bg-gradient-to-br from-[#C9A86A] to-[#d8ba7f] flex items-center justify-center shadow-[0_10px_34px_-8px_rgba(201,168,106,0.8)] transition-transform group-hover:scale-105">
                  <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" className="translate-x-[2px]">
                    <path fill="#0B1D3A" d="M8 5v14l11-7z" />
                  </svg>
                </span>
                <span className="relative text-[13px] font-bold text-slate-200">
                  Video hướng dẫn sử dụng
                </span>
              </button>
            )}
          </div>
        </div>

        <p className="mt-3 text-center text-[12px] text-slate-400">
          Không cần cài đặt gì thêm — làm theo video là dùng được ngay.
        </p>
      </div>
    </section>
  );
}
