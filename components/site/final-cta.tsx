"use client";

import Link from "next/link";
import { trackEvent } from "@/lib/analytics";

// CTA cuối trang — cùng wording với hero để không phân tâm
export function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-navy">
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
      <div className="absolute -top-24 left-[-100px] w-[420px] h-[420px] bg-gold/15 rounded-full blur-[90px]" />

      <div className="relative mx-auto max-w-[1120px] px-5 md:px-8 py-14 md:py-20 text-center">
        <h2 className="text-[26px] md:text-[38px] font-black leading-[1.1] tracking-tight text-white max-w-[720px] mx-auto">
          Đừng mất thời gian đọc hàng trăm tin mỗi ngày.
        </h2>
        <p className="mt-4 text-[16px] md:text-[20px] font-bold text-gold max-w-[680px] mx-auto">
          Để CheckBDS giúp bạn biết tin nào đáng gọi trước.
        </p>

        <div className="mt-8">
          <Link
            href="#kiem-tra"
            onClick={() => trackEvent("demo_started", { from: "final_cta" })}
            className="inline-flex h-[54px] px-9 rounded-[12px] bg-gradient-to-r from-[#C9A86A] to-[#d8ba7f] text-navy text-[16px] font-black items-center justify-center hover:from-[#d8ba7f] hover:to-[#e3ca92] transition shadow-[0_12px_34px_-8px_rgba(201,168,106,0.7)]"
          >
            Dùng miễn phí – 20 tin/ngày
          </Link>
        </div>
        <p className="mt-3 text-[13px] text-slate-400">Không cần thẻ • Đăng nhập Google trong 10 giây</p>
      </div>
    </section>
  );
}
