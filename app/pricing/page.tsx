"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { PaymentBox } from "@/components/pricing/payment-box";
import { PricingTracker } from "@/components/pricing/pricing-tracker";
import { quotePrice, isProPlan } from "@/lib/payments";
import { trackEvent } from "@/lib/analytics";

export default function PricingPage() {
  const [months, setMonths] = useState(3);
  const q = quotePrice(months);
  // Entitlement hiện tại: PRO user thấy plan + hạn dùng, KHÔNG hiển thị CTA nâng cấp giả.
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [planExpiresAt, setPlanExpiresAt] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch("/api/payments/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        setCurrentPlan(typeof data.plan === "string" ? data.plan : null);
        setPlanExpiresAt(typeof data.plan_expires_at === "string" ? data.plan_expires_at : null);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

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
            Chấm 500 tin/ngày, chỉ còn vài tin đáng gọi
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
            {isProPlan(currentPlan) ? (
              <div className="relative mt-6 rounded-[14px] bg-emerald-950/50 border border-emerald-700/50 p-4">
                <div className="text-[14px] font-black text-emerald-300">
                  Gói hiện tại: {(currentPlan ?? "pro").toUpperCase()}
                </div>
                <p className="mt-1 text-[12px] text-emerald-200">
                  {planExpiresAt
                    ? `Hết hạn ${new Date(planExpiresAt).toLocaleDateString("vi-VN")}`
                    : "Đã kích hoạt"}
                  . Bạn đang dùng gói này rồi, không cần thanh toán lại.
                </p>
                <Link
                  href="/dashboard"
                  className="mt-3 inline-flex h-12 px-4 rounded-[10px] bg-emerald-600 text-white text-[13px] font-bold items-center hover:bg-emerald-500 transition"
                >
                  Mở Dashboard →
                </Link>
              </div>
            ) : (
              <a
                href="#thanh-toan"
                onClick={() => trackEvent("upgrade_clicked", { from: "pricing_pro", months })}
                className="relative mt-6 h-[48px] rounded-[12px] bg-gradient-to-r from-[#C9A86A] to-[#d8ba7f] text-navy text-[14px] font-black flex items-center justify-center hover:from-[#d8ba7f] hover:to-[#e3ca92] transition"
              >
                Nâng cấp PRO
              </a>
            )}
            <div className="relative mt-3 space-y-1 text-[11px] text-slate-300 text-center">
              <div>✓ Hoàn tiền 100% trong 3 ngày nếu không phù hợp</div>
              <div>✓ Có thể hủy bất kỳ lúc nào</div>
            </div>
          </div>
        </div>

        {!isProPlan(currentPlan) && (
          <div id="thanh-toan" className="mt-10 scroll-mt-24">
            <PaymentBox months={months} onMonthsChange={setMonths} />
          </div>
        )}
        {isProPlan(currentPlan) && (
          <div className="mt-10 rounded-[18px] border border-emerald-700/40 bg-emerald-950/40 p-5">
            <div className="text-[15px] font-black text-emerald-300">
              Bạn đang dùng gói {(currentPlan ?? "pro").toUpperCase()} rồi.
            </div>
            <p className="mt-1 text-[12px] text-emerald-200">
              Không cần mua lại giao dịch mới — quản lý gói hiện có trong
              Dashboard sau khi đăng nhập.
            </p>
            <Link
              href="/dashboard"
              className="mt-3 inline-flex h-12 px-4 rounded-[10px] bg-emerald-600 text-white text-[12px] font-bold items-center hover:bg-emerald-500 transition"
            >
              Mở Dashboard →
            </Link>
          </div>
        )}

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
