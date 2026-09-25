import Link from "next/link";
import { LeadForm } from "@/components/leads/lead-form";

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
              CHO MÔI GIỚI BẤT ĐỘNG SẢN VIỆT NAM
            </div>

            <h2 className="mt-5 text-[28px] md:text-[42px] font-black leading-[1.02] tracking-[-0.02em] text-white">
              Môi giới cả nước lọc 100 tin trong 1 phút
              <br />
              <span className="text-gold">Không bỏ lỡ kèo ngộp</span>
            </h2>

            <p className="mt-4 text-[15px] md:text-[17px] leading-[1.6] text-slate-300 max-w-[520px]">
              Dán tin, upload file Zalo, AI chấm điểm 6 tiêu chí và lọc ra kèo ngộp &gt;80 điểm. Bạn chỉ việc gọi
              chủ nhà.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="#dang-ky"
                className="h-[48px] px-7 rounded-[12px] bg-gold text-navy text-[15px] font-bold flex items-center justify-center hover:bg-[#d4b678] transition"
              >
                Dùng thử miễn phí →
              </a>
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

          {/* Khối video demo đã ẩn cho tới khi có video thật. Tạm hiện ví dụ kết quả (không phải ảnh chụp màn hình). */}
          <div className="relative rounded-[20px] overflow-hidden border border-white/15 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] bg-white">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <span className="text-[11px] font-black tracking-[0.12em] text-slate-500">VÍ DỤ KẾT QUẢ</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                Phân tích bằng AI
              </span>
            </div>

            <div className="p-5 flex items-center gap-5">
              <div className="w-[84px] h-[84px] shrink-0 rounded-full border-[6px] border-emerald-500 bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <div className="text-center leading-none">
                  <div className="text-[26px] font-black tracking-tight">88</div>
                  <div className="text-[10px] font-bold tracking-widest mt-0.5">/100</div>
                </div>
              </div>
              <div className="min-w-0">
                <div className="inline-flex px-3 py-1 rounded-full text-[11px] font-black tracking-[0.12em] border bg-emerald-600 text-white border-emerald-600">
                  KÈO NGỘP NGON
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <span className="px-2 py-1 rounded-full bg-slate-100 border border-slate-200">💰 5.5 tỷ</span>
                  <span className="px-2 py-1 rounded-full bg-slate-100 border border-slate-200">📐 80m²</span>
                  <span className="px-2 py-1 rounded-full bg-navy text-white">📍 Hà Nội</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 px-5 pb-5 text-[11px]">
              {[
                ["Ngộp bank", "92%"],
                ["Thanh khoản", "88/100"],
                ["Pháp lý", "95% an toàn"],
                ["Giá vs thị trường", "Rẻ hơn ~15%"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[12px] border border-slate-200 px-3 py-2">
                  <div className="text-slate-500">{label}</div>
                  <div className="font-black text-navy mt-0.5">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div id="dang-ky" className="relative mt-10 scroll-mt-24">
          <LeadForm />
        </div>
      </div>
    </section>
  );
}
