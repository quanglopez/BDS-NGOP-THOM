"use client";

import { useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { PaymentBox } from "@/components/pricing/payment-box";
import { PricingTracker } from "@/components/pricing/pricing-tracker";
import { DURATIONS, quotePrice } from "@/lib/payments";
import { trackEvent } from "@/lib/analytics";

export default function PricingPage() {
  const [months, setMonths] = useState(3);
  const q = quotePrice(months);

  const FREE = [
    "20 tin/ngày",
    "Check từng tin",
    "AI scoring 6 tiêu chí",
    "Phân tích cơ bản",
    "Không cần thẻ",
  ];

  const PRO = [
    "500 tin/ngày",
    "Bulk Check 100 tin/lần",
    "Quét cả trang danh mục",
    "Phân tích nâng cao + giải thích điểm",
    "Lọc nhanh tin tiềm năng",
    "Ưu tiên tin điểm cao",
    "Hỗ trợ môi giới chuyên nghiệp",
  ];

  const FAQ = [
    {
      q: "Thanh toán thế nào? Có hoàn tiền không?",
      a: "Chuyển khoản VietQR — hệ thống tự kích hoạt gói trong 1–2 phút. Hoàn tiền 100% trong 3 ngày đầu nếu công cụ không hữu ích cho bạn.",
    },
    {
      q: "Gói có tự động gia hạn không?",
      a: "Không. Khi hết hạn hệ thống tự về gói Free, bạn chỉ mất lượt check nâng cao.",
    },
    {
      q: "Mua nhiều tháng thì sao?",
      a: "Chọn gói 3 tháng hoặc 1 năm để được giảm giá thật (tổng tiền thấp hơn mua lẻ từng tháng). Mỗi lần mua cộng dồn vào hạn đang có, không mất ngày.",
    },
    {
      q: "Tôi có thể hủy PRO không?",
      a: "Có, hủy bất kỳ lúc nào — vì gói không tự động gia hạn nên bạn không phải làm gì thêm.",
    },
    {
      q: "Tin rao của tôi có bị lưu không?",
      a: "Nội dung tin chỉ dùng để chấm điểm tại thời điểm check. Điểm số và link tin được lưu vào lịch sử của riêng bạn để tra cứu, không chia sẻ cho bên thứ ba.",
    },
  ];

  return (
    <main className="min-h-screen bg-cream">
      <PricingTracker />
      <SiteHeader />

      <section className="mx-auto max-w-[1120px] px-5 md:px-8 pt-12 pb-8">
        <div className="text-center max-w-[640px] mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-navy text-white text-[11px] font-bold tracking-widest">
            BẢNG GIÁ
          </div>
          <h1 className="mt-4 text-[28px] md:text-[40px] font-black leading-[1.05] tracking-tight text-navy">
            1 kèo ngộp ngon = vài trăm triệu biên lợi nhuận
          </h1>
          <p className="mt-3 text-[14px] text-slate-500">
            Bắt đầu miễn phí. Nâng cấp PRO khi bạn cần lọc hàng trăm tin mỗi ngày.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch">
          {/* FREE */}
          <div className="rounded-[20px] border border-slate-200 bg-white p-6 md:p-7 flex flex-col">
            <div className="text-[12px] font-black tracking-widest text-slate-500">FREE</div>
            <div className="mt-3 flex items-baseline gap-2">
              <div className="text-[38px] font-black text-navy">0đ</div>
              <div className="text-[13px] text-slate-500">/ mãi mãi</div>
            </div>
            <ul className="mt-5 space-y-2.5 flex-1">
              {FREE.map((f) => (
                <li key={f} className="flex gap-2.5 text-[13px] text-slate-600">
                  <span className="text-emerald-600 font-bold">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/#kiem-tra"
              className="mt-6 h-[48px] rounded-[12px] border border-slate-200 bg-white hover:bg-slate-50 text-[14px] font-bold text-slate-700 flex items-center justify-center transition"
            >
              Dùng miễn phí
            </Link>
            <div className="mt-3 text-[11px] text-center text-slate-400">Không cần thẻ • Không cần nhập SĐT</div>
          </div>

          {/* PRO */}
          <div className="rounded-[20px] bg-navy text-white p-6 md:p-7 flex flex-col relative overflow-hidden shadow-[0_24px_70px_-24px_rgba(11,29,58,0.6)]">
            <div className="absolute -top-24 right-[-80px] w-[300px] h-[300px] bg-gold/15 rounded-full blur-[70px]" />
            <div className="relative flex items-center gap-2">
              <div className="text-[12px] font-black tracking-widest text-gold">PRO</div>
              <span className="px-2 py-0.5 rounded-full bg-gold text-navy text-[10px] font-black">PHỔ BIẾN</span>
            </div>
            <div className="relative mt-3 flex items-baseline gap-2">
              <div className="text-[38px] font-black">{q.perMonth.toLocaleString("vi-VN")}đ</div>
              <div className="text-[13px] text-slate-300">/ tháng</div>
            </div>
            <div className="relative mt-1 text-[12px] text-gold font-semibold">
              {q.saved > 0 ? (
                <>
                  Giá gốc <s>{q.fullPrice.toLocaleString("vi-VN")}đ</s> → tổng{" "}
                  <b>{q.total.toLocaleString("vi-VN")}đ</b> · tiết kiệm{" "}
                  {q.saved.toLocaleString("vi-VN")}đ
                </>
              ) : (
                <>299.000đ/tháng</>
              )}
            </div>
            <ul className="relative mt-5 space-y-2.5 flex-1">
              {PRO.map((f) => (
                <li key={f} className="flex gap-2.5 text-[13px] text-slate-200">
                  <span className="text-gold font-bold">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <a
              href="#thanh-toan"
              onClick={() => trackEvent("upgrade_clicked", { from: "pricing_pro", months })}
              className="relative mt-6 h-[48px] rounded-[12px] bg-gradient-to-r from-[#C9A86A] to-[#d8ba7f] text-navy text-[14px] font-black flex items-center justify-center hover:from-[#d8ba7f] hover:to-[#e3ca92] transition"
            >
              Nâng cấp PRO
            </a>
            <div className="relative mt-3 space-y-1 text-[11px] text-slate-300 text-center">
              <div>✓ Hoàn tiền 100% trong 3 ngày nếu không phù hợp</div>
              <div>✓ Có thể hủy bất kỳ lúc nào</div>
            </div>
          </div>
        </div>

        {/* Thời hạn */}
        <div className="mt-8 rounded-[18px] border border-slate-200 bg-white p-5 md:p-6">
          <h2 className="text-[15px] font-black text-navy">Mua dài hạn, giá tốt hơn</h2>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
            {DURATIONS.map((d) => {
              const qq = quotePrice(d.months);
              return (
                <button
                  key={d.months}
                  type="button"
                  onClick={() => setMonths(d.months)}
                  className={`relative rounded-[12px] border px-3 py-3 text-center transition ${
                    months === d.months ? "border-navy bg-navy text-white" : "border-slate-200 bg-white text-slate-700 hover:border-navy/40"
                  }`}
                >
                  {d.badge && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-gold text-navy text-[9px] font-black whitespace-nowrap">
                      {d.badge}
                    </span>
                  )}
                  <div className="text-[13px] font-black">{d.label}</div>
                  {qq.saved > 0 ? (
                    <>
                      <div className={`mt-1 text-[11px] line-through ${months === d.months ? "text-slate-300" : "text-slate-400"}`}>
                        {qq.fullPrice.toLocaleString("vi-VN")}đ
                      </div>
                      <div className="text-[14px] font-black text-navy">{qq.total.toLocaleString("vi-VN")}đ</div>
                      <div className="mt-0.5 text-[10px] text-emerald-600 font-bold">
                        Tiết kiệm {qq.saved.toLocaleString("vi-VN")}đ
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mt-1 text-[14px] font-black text-navy">{qq.total.toLocaleString("vi-VN")}đ</div>
                      <div className={`mt-0.5 text-[10px] ${months === d.months ? "text-slate-300" : "text-slate-400"}`}>
                        Không giảm giá
                      </div>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div id="thanh-toan" className="mt-10 scroll-mt-24">
          <PaymentBox months={months} onMonthsChange={setMonths} />
        </div>

        <div className="mt-12 rounded-[18px] border border-slate-200 bg-white p-6">
          <h2 className="text-[18px] font-black text-navy">Câu hỏi thường gặp</h2>
          <div className="mt-4 space-y-4 text-[13px]">
            {FAQ.map((f) => (
              <div key={f.q}>
                <div className="font-bold text-slate-800">{f.q}</div>
                <p className="mt-1 text-slate-500 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
