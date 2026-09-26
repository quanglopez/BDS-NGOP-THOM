"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PLANS, vietQrImageUrl, type PlanKey } from "@/lib/payments";

type PaymentInfo = { content: string; amount: number };

// Khung thanh toán VietQR: chọn gói -> hiện QR NANGCAP {user_id} -> chờ webhook nâng gói
export function PaymentBox() {
  const [plan, setPlan] = useState<PlanKey>("pro");
  const [payment, setPayment] = useState<PaymentInfo | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [upgraded, setUpgraded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const bankName = process.env.NEXT_PUBLIC_SEPAY_BANK_NAME ?? "Ngân hàng (cấu hình SEPAY)";
  const bankAccount = process.env.NEXT_PUBLIC_SEPAY_ACCOUNT ?? "Chưa cấu hình tài khoản nhận";

  // Tạo bản ghi thanh toán + lấy nội dung CK
  const createPayment = async (p: PlanKey) => {
    setPlan(p);
    setPayment(null);
    setUpgraded(false);
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: p }),
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
      setPayment({ content: data.content, amount: data.amount });
      setQrUrl(vietQrImageUrl(data.amount, data.content));
    } catch {
      setError("Lỗi mạng, bấm lại để thử.");
    } finally {
      setBusy(false);
    }
  };

  // Vào trang có #thanh-toan (bấm "Nâng cấp" từ dashboard) thì tạo QR luôn
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash.includes("thanh-toan")) {
      void createPayment("pro");
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
        if (timer.current) clearInterval(timer.current);
      }
    }, 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [payment, plan, upgraded]);

  const copyContent = async () => {
    if (!payment) return;
    await navigator.clipboard.writeText(payment.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-6 md:p-8">
      <h2 className="text-[18px] font-black text-navy">Thanh toán VietQR - tự nâng gói trong 1-2 phút</h2>
      <p className="mt-1 text-[13px] text-slate-500">
        Chọn gói → quét QR hoặc chuyển khoản đúng nội dung → hệ thống tự kích hoạt.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {(["pro"] as PlanKey[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => void createPayment(p)}
            disabled={busy}
            className={`h-10 px-5 rounded-full text-[13px] font-bold border transition ${
              plan === p ? "bg-navy text-white border-navy" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {PLANS[p].label} - {PLANS[p].price.toLocaleString("vi-VN")}đ/tháng
          </button>
        ))}
        <Button
          type="button"
          onClick={() => void createPayment(plan)}
          disabled={busy}
          className="h-10 px-5 rounded-full bg-gold text-navy text-[13px] font-bold hover:bg-[#d8ba7f]"
        >
          {busy ? "Đang tạo mã QR..." : payment ? "Tạo lại mã QR" : "Tạo mã QR chuyển khoản →"}
        </Button>
      </div>

      {needLogin && (
        <div className="mt-5 rounded-[14px] bg-amber-50 border border-amber-200 p-4 text-[13px] text-amber-800">
          Bạn cần{" "}
          <Link href="/login" className="font-bold underline">
            đăng nhập
          </Link>{" "}
          để thanh toán và nhận nâng cấp.
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-[14px] bg-red-50 border border-red-200 p-4 text-[13px] text-red-700">
          <b>Lỗi:</b> {error}
          <div className="mt-1 text-[12px] text-red-600">
            Nếu vẫn không được, chụp màn hình lỗi này gửi cho hỗ trợ.
          </div>
        </div>
      )}

      {payment && !upgraded && (
        <div className="mt-6 grid md:grid-cols-[220px_1fr] gap-6 items-start">
          <div className="rounded-[14px] border border-slate-200 p-3 bg-white">
            {qrUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrUrl} alt="VietQR" className="w-full rounded-[10px]" />
            ) : (
              <div className="aspect-square flex items-center justify-center text-[11px] text-slate-400 text-center p-3">
                Chưa cấu hình NEXT_PUBLIC_SEPAY_BANK / NEXT_PUBLIC_SEPAY_ACCOUNT để sinh QR
              </div>
            )}
          </div>

          <div className="text-[13px]">
            <dl className="space-y-2">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Ngân hàng</dt>
                <dd className="font-semibold text-slate-800">{bankName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Số tài khoản</dt>
                <dd className="font-semibold text-slate-800">{bankAccount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Số tiền</dt>
                <dd className="font-semibold text-navy">{payment.amount.toLocaleString("vi-VN")}đ</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Nội dung CK</dt>
                <dd className="flex items-center gap-2">
                  <code className="px-2 py-1 rounded bg-slate-100 border text-[12px] font-bold">{payment.content}</code>
                  <Button type="button" variant="outline" size="sm" onClick={copyContent} className="h-8 rounded-full">
                    {copied ? "Đã copy" : "Copy"}
                  </Button>
                </dd>
              </div>
            </dl>

            <p className="mt-4 text-[12px] text-slate-500 leading-relaxed">
              Lưu ý: nội dung CK phải đúng <b>{payment.content}</b> (có dấu cách). Sai nội dung sẽ không tự kích hoạt
              được, cần liên hệ hỗ trợ.
            </p>

            <div className="mt-3 flex items-center gap-2 text-[12px] text-emerald-700 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Đang chờ xác nhận từ ngân hàng...
            </div>
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
                • hết hạn{" "}
                <b>{new Date(expiresAt).toLocaleDateString("vi-VN")}</b>
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
    </div>
  );
}
