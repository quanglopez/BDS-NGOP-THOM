import Link from "next/link";

// Hero bán hàng + chỗ đặt video demo 20s
export function SalesHero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-navy via-[#132A56] to-navy" />
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-gold/10 rounded-full blur-[80px] -translate-y-1/2 -translate-x-1/4" />

      <div className="relative mx-auto max-w-[1120px] px-5 md:px-8 py-14 md:py-20">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] tracking-[0.12em] text-amber-200 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              CHO MÔI GIỚI BẤT ĐỘNG SẢN VŨNG TÀU
            </div>

            <h2 className="mt-5 text-[28px] md:text-[42px] font-black leading-[1.02] tracking-[-0.02em] text-white">
              Môi giới Vũng Tàu lọc 100 tin trong 1 phút
              <br />
              <span className="text-gold">Không bỏ lỡ kèo ngộp</span>
            </h2>

            <p className="mt-4 text-[15px] md:text-[17px] leading-[1.6] text-slate-300 max-w-[520px]">
              Dán tin, upload file Zalo, AI chấm điểm 6 tiêu chí và lọc ra kèo ngộp &gt;80 điểm. Bạn chỉ việc gọi
              chủ nhà.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="h-[48px] px-7 rounded-[12px] bg-gold text-navy text-[15px] font-bold flex items-center justify-center hover:bg-[#d4b678] transition"
              >
                Dùng thử miễn phí →
              </Link>
              <Link
                href="/pricing"
                className="h-[48px] px-7 rounded-[12px] border border-white/25 text-white text-[15px] font-semibold flex items-center justify-center hover:bg-white/10 transition"
              >
                Xem bảng giá
              </Link>
            </div>

            <div className="mt-4 text-[12px] text-slate-400">
              Free 20 tin/ngày • Không cần thẻ • Nâng cấp Pro 299k/tháng khi cần Bulk Check
            </div>
          </div>

          {/* Video demo 20s - thay <div> placeholder bằng thẻ <video> / YouTube embed khi có video */}
          <div className="relative rounded-[20px] overflow-hidden border border-white/15 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
            <div className="aspect-video bg-gradient-to-br from-[#162E5E] to-navy flex flex-col items-center justify-center gap-3">
              <div className="w-16 h-16 rounded-full bg-gold flex items-center justify-center">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="#0B1D3A" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <div className="text-[12px] tracking-widest text-slate-300 font-semibold">
                VIDEO DEMO 20S - ĐANG CẬP NHẬT
              </div>
              <div className="text-[11px] text-slate-400">Lọc 100 tin → ra 4 kèo ngộp ngon</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
