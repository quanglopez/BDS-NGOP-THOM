"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics";

// Thanh CTA dính cuối màn hình trên mobile — chỉ hiện sau khi scroll qua hero,
// và ẩn khi đã tới ô nhập hoặc cuối trang để không che nội dung.
export function StickyCta() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const box = document.getElementById("kiem-tra");
      const atBox = box
        ? box.getBoundingClientRect().top < window.innerHeight * 0.7 &&
          box.getBoundingClientRect().bottom > 0
        : false;
      const nearBottom =
        window.innerHeight + y > document.documentElement.scrollHeight - 240;
      setVisible(y > 420 && !atBox && !nearBottom);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`md:hidden fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 bg-white/95 backdrop-blur border-t border-line transition-transform duration-300 ${
        visible ? "translate-y-0" : "translate-y-[120%]"
      }`}
    >
      <Link
        href="#kiem-tra"
        onClick={() => trackEvent("demo_started", { from: "sticky_cta" })}
        className="flex h-[48px] w-full items-center justify-center rounded-md bg-gold-base text-body font-bold text-navy-900 shadow-lift transition-colors duration-micro ease-cb hover:bg-gold-soft"
      >
        Dùng miễn phí – 20 tin/ngày
      </Link>
    </div>
  );
}
