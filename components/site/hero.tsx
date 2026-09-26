"use client";

import { trackEvent } from "@/lib/analytics";

// Hero: lợi ích thực tế cho môi giới + CTA chính duy nhất
export function Hero() {
  return (
    <section className="relative overflow-hidden bg-navy">
      <div className="absolute inset-0 bg-gradient-to-br from-navy via-[#132A56] to-[#0B1D3A]" />
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
      <div className="absolute -top-32 right-[-120px] w-[560px] h-[560px] bg-gold/15 rounded-full blur-[100px]" />
      <div className="absolute bottom-[-200px] left-[-140px] w-[520px] h-[520px] bg-blue-600/20 rounded-full blur-[100px]" />

      <div className="relative mx-auto max-w-[1120px] px-5 md:px-8 pt-12 md:pt-16 pb-8">
        <div className="max-w-[720px]">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-[11px] tracking-[0.12em] text-slate-200 font-semibold mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            CHO MÔI GIỚI BẤT ĐỘNG SẢN • 63 TỈNH/THÀNH
          </div>

          <h1 className="text-[36px] md:text-[58px] font-black leading-[1.0] tracking-[-0.03em] text-white">
            Lọc 100 tin BĐS
            <br />
            trong <span className="text-transparent bg-clip-text bg-gradient-to-r from-gold to-[#e8cf9a]">1 phút</span>
          </h1>

          <p className="mt-4 text-[18px] md:text-[22px] font-bold text-slate-100">
            Biết tin nào đáng gọi chủ nhà trước.
          </p>

          <p className="mt-3 text-[15px] md:text-[16px] leading-[1.6] text-slate-300 max-w-[620px]">
            Dán link Nhà Tốt/Chợ Tốt hoặc nội dung tin rao. CheckBDS tự động phân tích{" "}
            <b className="text-white font-semibold">giá, vị trí, pháp lý, thanh khoản</b> và{" "}
            <b className="text-white font-semibold">dấu hiệu bán gấp</b> để giúp bạn ưu tiên những tin đáng gọi nhất.
          </p>

          <div className="mt-7 flex flex-col sm:flex-row sm:items-center gap-3">
            <a
              href="#kiem-tra"
              onClick={() => trackEvent("demo_started", { from: "hero" })}
              className="h-[52px] px-8 rounded-[12px] bg-gradient-to-r from-[#C9A86A] to-[#d8ba7f] text-navy text-[15px] font-black flex items-center justify-center hover:from-[#d8ba7f] hover:to-[#e3ca92] transition shadow-[0_10px_30px_-8px_rgba(201,168,106,0.7)]"
            >
              Dùng miễn phí – 20 tin/ngày
            </a>
            <a
              href="#demo"
              className="h-[52px] px-7 rounded-[12px] border border-white/25 text-white text-[15px] font-semibold flex items-center justify-center hover:bg-white/10 transition"
            >
              Xem demo
            </a>
          </div>

          <p className="mt-3 text-[13px] text-slate-400">Không cần thẻ • Đăng nhập Google trong 10 giây</p>
        </div>
      </div>
    </section>
  );
}
