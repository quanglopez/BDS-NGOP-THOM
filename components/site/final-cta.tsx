"use client";

import Link from "next/link";
import { trackEvent } from "@/lib/analytics";

// CTA cuối trang — cùng wording với hero để không phân tâm
export function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-navy-900">
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 100%, black 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 50% 100%, black 30%, transparent 75%)",
        }}
      />
      <div className="absolute -top-24 left-[-100px] h-[420px] w-[420px] rounded-full bg-gold-base/10 blur-[90px]" />

      <div className="relative mx-auto max-w-[1120px] px-5 py-14 text-center md:px-8 md:py-20">
        <h2 className="mx-auto max-w-[720px] font-display text-h2 leading-[1.1] text-white">
          Đừng mất thời gian đọc hàng trăm tin mỗi ngày.
        </h2>
        <p className="mx-auto mt-4 max-w-[680px] text-lead font-display font-bold text-gold-base">
          Để CheckBDS giúp bạn biết tin nào đáng gọi trước.
        </p>

        <div className="mt-8">
          <Link
            href="#kiem-tra"
            onClick={() => trackEvent("demo_started", { from: "final_cta" })}
            className="inline-flex h-[54px] items-center justify-center rounded-md bg-gold-base px-9 text-body font-bold text-navy-900 shadow-lift transition-colors duration-micro ease-cb hover:bg-gold-soft"
          >
            Dùng miễn phí – 20 tin/ngày
          </Link>
        </div>
        <p className="mt-3 text-micro text-ink-on-navy-muted">
          Không cần thẻ • Đăng nhập Google trong 10 giây
        </p>
      </div>
    </section>
  );
}
