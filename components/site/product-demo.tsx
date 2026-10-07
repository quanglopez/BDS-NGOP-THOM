"use client";

import { trackEvent } from "@/lib/analytics";
import { YouTubeFacade } from "@/components/site/youtube-facade";

// Video hướng dẫn sử dụng — đặt tại vị trí Demo mà nút "Xem demo" trên hero trỏ tới.
// Dạng facade (YouTubeFacade): chỉ hiện thumbnail, chỉ tải iframe khi khách bấm Play,
// để LCP mobile vẫn nhanh (không tải JS/cookie của bên thứ ba trước khi khách xem).
const YOUTUBE_ID = "C14TG2CZxDQ";
const VIDEO_TITLE = "Phát video hướng dẫn sử dụng CheckBDS";

export function ProductDemo() {
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
        <div className="overflow-hidden rounded-panel border border-line-navy bg-navy-900 shadow-navy">
          <YouTubeFacade
            videoId={YOUTUBE_ID}
            title={VIDEO_TITLE}
            onStart={() => trackEvent("demo_started", { from: "video" })}
          />
        </div>

        <p className="mt-3 text-center text-micro text-ink-500">
          Không cần cài đặt gì thêm — làm theo video là dùng được ngay.
        </p>
      </div>
    </section>
  );
}
