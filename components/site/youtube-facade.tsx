"use client";

import { useState } from "react";
import { Play } from "lucide-react";

// Facade YouTube dùng chung: mặc định chỉ hiện thumbnail, chỉ mount iframe
// sau khi khách bấm Play. Nhờ vậy lần tải trang đầu không phải tải JS/cookie
// của YouTube — LCP mobile vẫn nhanh. Khung giữ cứng tỉ lệ 16:9 nên layout
// không nhảy kể cả khi thumbnail hay iframe chưa tải xong.
const THUMB_BASE = "https://img.youtube.com/vi";

export type YouTubeFacadeProps = {
  videoId: string;
  /** Dùng cho cả title của iframe và aria-label của nút Play. */
  title: string;
  /** Gọi khi khách bấm Play (đo chuyển đổi). */
  onStart?: () => void;
  /** Kích thước vòng Play: "md" mặc định, "sm" cho hero. */
  playSize?: "sm" | "md";
};

const PLAY_SIZE = {
  sm: "h-[64px] w-[64px]",
  md: "h-[72px] w-[72px]",
} as const;

const PLAY_ICON = {
  sm: 24,
  md: 26,
} as const;

export function YouTubeFacade({
  videoId,
  title,
  onStart,
  playSize = "md",
}: YouTubeFacadeProps) {
  const [playing, setPlaying] = useState(false);
  // Ưu tiên maxresdefault; chỉ lùi về hqdefault một lần nếu video không có bản maxres.
  const [thumb, setThumb] = useState(() => `${THUMB_BASE}/${videoId}/maxresdefault.jpg`);

  const start = () => {
    setPlaying(true);
    onStart?.();
  };

  const fallbackThumb = () => {
    setThumb((current) =>
      current.endsWith("/maxresdefault.jpg") ? `${THUMB_BASE}/${videoId}/hqdefault.jpg` : current,
    );
  };

  return (
    <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
      {playing ? (
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
          title={title}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={start}
          aria-label={title}
          className="group absolute inset-0 flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-base"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumb}
            onError={fallbackThumb}
            alt=""
            width={1280}
            height={720}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Lớp phủ nhẹ để nút Play nổi bật trên cả thumbnail sáng lẫn tối */}
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-navy-900/25 transition-colors duration-micro ease-cb group-hover:bg-navy-900/10"
          />
          <span
            aria-hidden="true"
            className={`relative flex ${PLAY_SIZE[playSize]} items-center justify-center rounded-full bg-gold-base shadow-lift transition-transform duration-micro ease-cb group-hover:scale-105 group-focus-visible:scale-105`}
          >
            <Play
              size={PLAY_ICON[playSize]}
              strokeWidth={1.75}
              aria-hidden="true"
              className="translate-x-[2px] fill-navy-900 text-navy-900"
            />
          </span>
        </button>
      )}
    </div>
  );
}