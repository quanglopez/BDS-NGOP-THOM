"use client";

import Link from "next/link";
import { X } from "lucide-react";
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
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-navy-900/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[420px] overflow-hidden rounded-panel bg-white shadow-navy">
        <div className="relative overflow-hidden bg-gradient-to-br from-navy-800 via-navy-700 to-navy-900 px-6 pb-5 pt-6">
          <div className="absolute -right-10 -top-16 h-[200px] w-[200px] rounded-full bg-gold-base/20 blur-[60px]" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="group absolute right-1.5 top-1.5 z-10 flex h-12 w-12 items-center justify-center rounded-full text-white"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 leading-none transition-colors duration-micro ease-cb group-hover:bg-white/20">
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
            </span>
          </button>
          <div className="relative font-display text-h3 font-extrabold leading-tight text-white">
            {dailyLimit > 0
              ? `Bạn đã dùng hết ${dailyLimit} lượt hôm nay`
              : "Bạn đã dùng hết lượt hôm nay"}
          </div>
          <p className="relative mt-2 text-small text-ink-on-navy-muted">
            Nâng cấp PRO để tiếp tục check nhiều hơn mỗi ngày.
          </p>
        </div>

        <div className="p-5">
          <ul className="space-y-1.5 text-small text-ink-600">
            {["500 tin/ngày", "Bulk Check 100 tin/lần", "Quét cả trang danh mục", "Phân tích nâng cao"].map((f) => (
              <li key={f} className="flex gap-2">
                <span className="font-bold text-ai-ink">✓</span>
                {f}
              </li>
            ))}
          </ul>

          <Link
            href="/pricing#thanh-toan"
            onClick={() => trackEvent("upgrade_clicked", { from: "limit_modal", plan })}
            className="mt-5 flex h-[50px] w-full items-center justify-center rounded-md bg-gold-base text-small font-bold text-navy-900 transition-colors duration-micro ease-cb hover:bg-gold-soft"
          >
            Nâng cấp PRO – 299.000đ/tháng
          </Link>

          <p className="mt-3 text-center text-micro text-ink-500">
            Hoàn tiền 100% trong 3 ngày nếu không phù hợp
          </p>

          <button
            type="button"
            onClick={onClose}
            className="mt-2 w-full text-micro text-ink-500 transition-colors duration-micro ease-cb hover:text-ink-700"
          >
            Để sau
          </button>
        </div>
      </div>
    </div>
  );
}
