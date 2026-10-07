"use client";

import { useState } from "react";
import { Play } from "lucide-react";
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
    <section id="demo" className="mx-auto max-w-[1120px] scroll-mt-20 px-5 py-12 md:px-8 md:py-16">
      <div className="mx-auto max-w-[640px] text-center">
        <div className="text-micro font-semibold uppercase tracking-[0.09em] text-gold-ink">
          Xem demo
        </div>
        <h2 className="mt-3 font-display text-h2 text-ink-900">Xem thao tác trong 2 phút</h2>
        <p className="mt-3 text-lead text-ink-600">
          Xem cách dán tin, quét danh mục và lọc ra những kèo đáng gọi trước — không cần đọc tài liệu.
        </p>
      </div>

      <div className="mx-auto mt-8 max-w-[880px]">
        <div className="relative overflow-hidden rounded-panel border border-line-navy bg-navy-900 shadow-navy">
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
                className="group absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-navy-800 via-navy-700 to-navy-900"
              >
                <div
                  className="absolute inset-0 opacity-[0.13]"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
                    backgroundSize: "44px 44px",
                    maskImage: "radial-gradient(ellipse 80% 70% at 50% 50%, black 30%, transparent 75%)",
                    WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 50% 50%, black 30%, transparent 75%)",
                  }}
                />
                <span className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full bg-gold-base shadow-lift transition-transform duration-micro ease-cb group-hover:scale-105">
                  <Play size={26} strokeWidth={1.75} aria-hidden="true" className="translate-x-[2px] fill-navy-900 text-navy-900" />
                </span>
                <span className="relative text-small font-bold text-ink-on-navy">
                  Video hướng dẫn sử dụng
                </span>
              </button>
            )}
          </div>
        </div>

        <p className="mt-3 text-center text-micro text-ink-500">
          Không cần cài đặt gì thêm — làm theo video là dùng được ngay.
        </p>
      </div>
    </section>
  );
}
