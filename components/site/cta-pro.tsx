import Link from "next/link";
import { Button } from "@/components/ui/button";

const FEATURES = [
  "Bulk Check 100 tin Zalo/lần",
  "Lọc kèo ngộp >80 điểm",
  "Xuất Excel kèo ngon",
  "Lịch sử + thống kê đầu tư",
];

// CTA bán gói Pro cho môi giới
export function CtaPro() {
  return (
    <section className="mx-auto max-w-[1120px] px-5 md:px-8 pb-12">
      <div className="rounded-[24px] bg-navy p-[1px]">
        <div className="rounded-[23px] bg-gradient-to-br from-navy to-[#162E5E] p-6 md:p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-gold/15 rounded-full blur-[60px] -translate-y-1/2 translate-x-1/3" />

          <div className="relative flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
            <div className="max-w-[560px]">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gold text-navy text-[11px] font-black tracking-widest">
                DÀNH CHO MÔI GIỚI CHUYÊN NGHIỆP
              </div>
              <h3 className="mt-4 text-[24px] md:text-[30px] font-black leading-[1.05] text-white">
                Bulk check 100 tin trong 1 phút, lọc kèo ngộp &gt;80 điểm, xuất Excel cho cả team
              </h3>
              <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[13px] text-slate-300">
                {FEATURES.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-gold">✓</span> {f}
                  </li>
                ))}
              </ul>
            </div>

            <div className="w-full md:w-[320px] shrink-0 rounded-[18px] bg-white p-5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.5)]">
              <div className="text-[11px] font-bold tracking-widest text-slate-500">PRO PLAN</div>
              <div className="mt-2 flex items-baseline gap-2">
                <div className="text-[32px] font-black text-navy">299k</div>
                <div className="text-[13px] text-slate-500">/ tháng</div>
                <div className="ml-auto text-[11px] px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                  Tiết kiệm 40%
                </div>
              </div>
              <div className="mt-3 text-[12px] text-slate-500">
                Cho 100 tin/ngày • Không giới hạn khu vực • Hủy bất kỳ lúc nào
              </div>
              <Button
                asChild
                className="mt-4 w-full h-[44px] rounded-[12px] bg-navy text-white font-bold text-[14px] hover:bg-black transition"
              >
                <Link href="/pricing#thanh-toan">Nâng cấp Pro - 500 tin/ngày</Link>
              </Button>
              <div className="mt-3 text-[11px] text-center text-slate-400">
                Thanh toán chuyển khoản VietQR • Tự kích hoạt
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
