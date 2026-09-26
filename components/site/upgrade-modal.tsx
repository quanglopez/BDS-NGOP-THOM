"use client";

import Link from "next/link";
import { trackEvent } from "@/lib/analytics";

// Popup nâng cấp — CHỈ hiện khi khách đã chạm giới hạn lượt trong ngày,
// không hiện sớm để không làm gián đoạn luồng trải nghiệm.
export function UpgradeModal({
  open,
  dailyLimit,
  plan,
  onClose,
}: {
  open: boolean;
  dailyLimit: number;
  plan: string;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-navy/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[420px] rounded-[20px] bg-white shadow-[0_30px_90px_-20px_rgba(0,0,0,0.6)] overflow-hidden">
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-navy via-[#132A56] to-navy overflow-hidden">
          <div className="absolute -top-16 right-[-40px] w-[200px] h-[200px] bg-gold/20 rounded-full blur-[60px]" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/10 text-white text-[16px] leading-none hover:bg-white/20 transition"
          >
            ×
          </button>
          <div className="relative text-[18px] font-black text-white leading-tight">
            Bạn đã dùng hết {dailyLimit} lượt miễn phí hôm nay
          </div>
          <p className="relative mt-2 text-[13px] text-slate-300">
            Nâng cấp PRO để tiếp tục check tới 500 tin/ngày.
          </p>
        </div>

        <div className="p-5">
          <ul className="space-y-1.5 text-[13px] text-slate-600">
            {["500 tin/ngày", "Bulk Check 100 tin/lần", "Quét cả trang danh mục", "Phân tích nâng cao"].map((f) => (
              <li key={f} className="flex gap-2">
                <span className="text-emerald-600 font-bold">✓</span>
                {f}
              </li>
            ))}
          </ul>

          <Link
            href="/pricing#thanh-toan"
            onClick={() => trackEvent("upgrade_clicked", { from: "limit_modal", plan })}
            className="mt-5 h-[50px] w-full rounded-[12px] bg-gradient-to-r from-[#C9A86A] to-[#d8ba7f] text-navy text-[14px] font-black flex items-center justify-center hover:from-[#d8ba7f] hover:to-[#e3ca92] transition"
          >
            Nâng cấp PRO – 299.000đ/tháng
          </Link>

          <p className="mt-3 text-center text-[12px] text-slate-500">
            Hoàn tiền 100% trong 3 ngày nếu không phù hợp
          </p>

          <button
            type="button"
            onClick={onClose}
            className="mt-2 w-full text-[12px] text-slate-400 hover:text-slate-600"
          >
            Để sau
          </button>
        </div>
      </div>
    </div>
  );
}
