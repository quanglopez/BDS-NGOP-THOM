"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DURATIONS, quotePrice, vietQrImageUrl, type PlanKey } from "@/lib/payments";
import { trackEvent } from "@/lib/analytics";

type PaymentInfo = { content: string; amount: number };

const TRUST = [
  "🔒 Thanh toán an toàn",
  "✓ Hoàn tiền 100% trong 3 ngày",
  "✓ Không tự động gia hạn",
];

// Khung thanh toán VietQR: chọn thời hạn -> hiện QR + thông tin CK -> chờ webhook nâng gói.
// Ưu tiên thao tác một tay trên điện thoại: copy STK / copy nội dung CK.
export function PaymentBox() {
  const [plan] = useState<PlanKey>("pro");
  const [months, setMonths] = useState(3);
  const [payment, setPayment] = useState<PaymentInfo | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [upgraded, setUpgraded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const bankName = process.env.NEXT_PUBLIC_SEPAY_BANK_NAME ?? "";
  const bankAccount = process.env.NEXT_PUBLIC_SEPAY_ACCOUNT ?? "";
  const accountName = process.env.NEXT_PUBLIC_SEPAY_ACCOUNT_NAME ?? "";
  const quote = quotePrice(months);

  const createPayment = async (m: number) => {
    setMonths(m);
    setPayment(null);
    setUpgraded(false);
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, months: m }),
      });
      if (res.status === 401) {
        setNeedLogin(true);
        return;
      }
      const data = await res.json().catch(() => ({ error: "Phản hồi từ máy chủ không hợp lệ" }));
      if (data.error) {
        setError(data.error);
        return;
      }
      if (!data.content) {
        setError("Không tạo được nội dung chuyển khoản, thử lại sau.");
        return;
      }
      trackEvent("checkout_started", { months: m, amount: data.amount });
      setPayment({ content: data.content, amount: data.amount });
      setQrUrl(vietQrImageUrl(data.amount, data.content));
    } catch {
      setError("Lỗi mạng, bấm lại để thử.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash.includes("thanh-toan")) {
      void createPayment(3);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll trạng thái: khi webhook nâng gói thì báo thành công
  useEffect(() => {
    if (!payment || upgraded) return;
    timer.current = setInterval(async () => {
      const res = await fetch("/api/payments/status");
      if (!res.ok) return;
      const data = await res.json();
      setPlanName(data.plan);
      setExpiresAt(data.plan_expires_at ?? null);
      if (data.plan === plan) {
        setUpgraded(true);
        trackEvent("payment_completed", { months, amount: payment.amount });
        if (timer.current) clearInterval(timer.current);
      }
    }, 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment, plan, upgraded]);

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Trình duyệt không cho copy — hãy giữ đè vào số để copy thủ công.");
    }
  };

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-5 md:p-8">
      <h2 className="text-[18px] font-black text-navy">Thanh toán chuyển khoản VietQR</h2>
      <p className="mt-1 text-[13px] text-slate-500">Tự kích hoạt gói trong 1–2 phút sau khi tiền vào.</p>

      {/* Chọn thời hạn */}
      <div className="mt-5">
        <div className="text-[11px] font-black tracking-[0.14em] text-slate-500">CHỌN THỜI HẠN</div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
          {DURATIONS.map((d) => {
            const q = quotePrice(d.months);
            const active = months === d.months;
            return (
              <button
                key={d.months}
                type="button"
                onClick={() => {
                  setMonths(d.months);
                  setPayment(null);
                  setUpgraded(false);
                  trackEvent("upgrade_clicked", { months: d.months, from: "duration" });
                }}
                className={`relative rounded-[12px] border px-3 py-3 text-center transition ${
                  active
                    ? "border-navy bg-navy text-white shadow-[0_8px_24px_-10px_rgba(11,29,58,0.6)]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-navy/40"
                }`}
              >
                {d.badge && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-gold text-navy text-[9px] font-black whitespace-nowrap">
                    {d.badge}
                  </span>
                )}
                <div className="text-[13px] font-black">{d.label}</div>
                <div className={`mt-1 text-[12px] font-bold ${active ? "text-gold" : "text-navy"}`}>
                  {q.total.toLocaleString("vi-VN")}đ
                </div>
                {q.saved > 0 && (
                  <div className={`mt-0.5 text-[10px] ${active ? "text-slate-300" : "text-emerald-600"}`}>
                    Tiết kiệm {q.saved.toLocaleString("vi-VN")}đ
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-2 text-[11px] text-slate-400">
          {quote.saved > 0 ? (
            <>
              Giá gốc <s>{quote.fullPrice.toLocaleString("vi-VN")}đ</s> →{" "}
              <b className="text-navy">{quote.total.toLocaleString("vi-VN")}đ</b> (≈{" "}
              {quote.perMonth.toLocaleString("vi-VN")}đ/tháng)
            </>
          ) : (
            <>299.000đ/tháng — hủy bất kỳ lúc nào</>
          )}
        </div>
      </div>

      <div className="mt-5">
        <Button
          type="button"
          onClick={() => void createPayment(months)}
          disabled={busy}
          className="h-[52px] w-full rounded-[12px] bg-gradient-to-r from-[#C9A86A] to-[#d8ba7f] text-navy text-[15px] font-black hover:from-[#d8ba7f] hover:to-[#e3ca92] disabled:opacity-50"
        >
          {busy ? "Đang tạo mã QR..." : payment ? "Tạo lại thông tin chuyển khoản" : "Tạo thông tin chuyển khoản →"}
        </Button>
      </div>

      {needLogin && (
        <div className="mt-5 rounded-[14px] bg-amber-50 border border-amber-200 p-4 text-[13px] text-amber-800">
          Bạn cần{" "}
          <Link href="/login" onClick={() => trackEvent("login_clicked", { from: "checkout" })} className="font-bold underline">
            đăng nhập Google
          </Link>{" "}
          để thanh toán và nhận nâng cấp.
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-[14px] bg-red-50 border border-red-200 p-4 text-[13px] text-red-700">
          <b>Lỗi:</b> {error}
        </div>
      )}

      {payment && !upgraded && (
        <div className="mt-6">
          {/* QR: chỉ hiện khi khách bấm (đa số chuyển bằng máy tính) */}
          {qrUrl && (
            <div className="mb-5">
              <button
                type="button"
                onClick={() => setShowQr((s) => !s)}
                className="text-[13px] font-bold text-navy hover:underline underline-offset-2"
              >
                {showQr ? "▾ Ẩn mã QR" : "▸ Hiện mã QR (khi bạn đang dùng máy tính)"}
              </button>
              {showQr && (
                <div className="mt-3 rounded-[14px] border border-slate-200 p-3 bg-white inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrUrl} alt="Mã QR chuyển khoản VietQR" className="w-[220px] rounded-[10px]" />
                </div>
              )}
            </div>
          )}

          {/* Thông tin CK — ưu tiên copy bằng một tay trên điện thoại */}
          <dl className="space-y-2.5 text-[13px]">
            {bankName && (
              <div className="flex items-center justify-between gap-4 rounded-[10px] bg-cream border border-slate-200 px-3 py-2.5">
                <dt className="text-slate-500 shrink-0">Ngân hàng</dt>
                <dd className="font-bold text-slate-800 text-right">{bankName}</dd>
              </div>
            )}
            {accountName && (
              <div className="flex items-center justify-between gap-4 rounded-[10px] bg-cream border border-slate-200 px-3 py-2.5">
                <dt className="text-slate-500 shrink-0">Chủ tài khoản</dt>
                <dd className="font-bold text-slate-800 text-right">{accountName}</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 rounded-[10px] bg-cream border border-slate-200 px-3 py-2.5">
              <div className="min-w-0">
                <dt className="text-slate-500 text-[11px]">Số tài khoản</dt>
                <dd className="font-black text-navy text-[15px] font-mono truncate">{bankAccount || "—"}</dd>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => copy("stk", bankAccount)}
                className="h-10 px-4 rounded-[10px] shrink-0 text-[12px] font-bold"
              >
                {copied === "stk" ? "Đã copy" : "Sao chép"}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-[10px] bg-cream border border-slate-200 px-3 py-2.5">
              <div className="min-w-0">
                <dt className="text-slate-500 text-[11px]">Số tiền</dt>
                <dd className="font-black text-navy text-[15px]">{payment.amount.toLocaleString("vi-VN")}đ</dd>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => copy("amount", String(payment.amount))}
                className="h-10 px-4 rounded-[10px] shrink-0 text-[12px] font-bold"
              >
                {copied === "amount" ? "Đã copy" : "Sao chép"}
              </Button>
            </div>
            <div className="rounded-[10px] bg-cream border border-slate-200 px-3 py-2.5">
              <dt className="text-slate-500 text-[11px]">Nội dung chuyển khoản</dt>
              <dd className="mt-1 flex items-center justify-between gap-3">
                <code className="text-[14px] font-black text-navy font-mono break-all">{payment.content}</code>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copy("content", payment.content)}
                  className="h-10 px-4 rounded-[10px] shrink-0 text-[12px] font-bold"
                >
                  {copied === "content" ? "Đã copy" : "Sao chép"}
                </Button>
              </dd>
            </div>
          </dl>

          <div className="mt-4 rounded-[12px] bg-[#FFFBF0] border border-gold/40 px-4 py-3 text-[12px] text-slate-700 leading-relaxed">
            <b>Cách nhanh nhất trên điện thoại:</b> bấm <b>Sao chép</b> từng dòng, mở app ngân hàng →
            chuyển khoản với đúng số tiền và nội dung trên. Nếu bạn đang dùng máy tính thì mở app ngân hàng
            trên điện thoại và quét mã QR.
          </div>

          <div className="mt-3 flex items-center gap-2 text-[12px] text-emerald-700 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Đang chờ xác nhận từ ngân hàng...
          </div>
        </div>
      )}

      {upgraded && (
        <div className="mt-6 rounded-[14px] bg-emerald-50 border border-emerald-200 p-5">
          <div className="text-[15px] font-black text-emerald-700">Nâng cấp thành công 🎉</div>
          <p className="mt-1 text-[13px] text-emerald-800">
            Gói hiện tại: <b>{(planName ?? plan).toUpperCase()}</b>
            {expiresAt && (
              <>
                {" "}
                • hết hạn <b>{new Date(expiresAt).toLocaleDateString("vi-VN")}</b>
              </>
            )}
            . Vào Dashboard để dùng Bulk Check ngay.
          </p>
          <Link
            href="/dashboard"
            className="mt-3 inline-flex h-9 px-4 rounded-full bg-emerald-600 text-white text-[12px] font-bold items-center"
          >
            Mở Dashboard →
          </Link>
        </div>
      )}

      {/* Trust signals */}
      <div className="mt-6 pt-4 border-t border-slate-200 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-slate-500">
        {TRUST.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}
