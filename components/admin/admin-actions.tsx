"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Nút thao tác admin: nâng Pro 1 tháng / hạ về Free / đánh dấu đã thu tiền
export function AdminActions({
  userId,
  paymentId,
  isPro,
  plan = "pro",
}: {
  userId?: string;
  paymentId?: string;
  isPro?: boolean;
  plan?: "pro" | "free";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  const run = (body: Record<string, unknown>) => {
    setMessage("");
    startTransition(async () => {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Lỗi");
        return;
      }
      setMessage("OK");
      router.refresh();
    });
  };

  const base = "h-8 px-3 rounded-full text-[11px] font-bold border";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {userId && !isPro && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run({ type: "set_plan", userId, plan: "pro", months: 1 })}
          className={`${base} bg-emerald-600 text-white border-emerald-600`}
        >
          +1 tháng Pro
        </button>
      )}

      {userId && isPro && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run({ type: "set_plan", userId, plan: "free", months: 0 })}
          className={`${base} bg-white text-slate-700 border-slate-200`}
        >
          Hạ về Free
        </button>
      )}

      {paymentId && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run({ type: "mark_paid", paymentId, plan, months: 1 })}
          className={`${base} bg-navy text-white border-navy`}
        >
          Đã thu tiền
        </button>
      )}

      {pending && <span className="text-[11px] text-slate-400">...</span>}
      {message && (
        <span className={`text-[11px] ${message === "OK" ? "text-emerald-600" : "text-red-600"}`}>
          {message}
        </span>
      )}
    </div>
  );
}
