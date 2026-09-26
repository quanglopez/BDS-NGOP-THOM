"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Form thu lead: dùng thử miễn phí (email + SĐT) -> bảng leads
export function LeadForm({ planInterest }: { planInterest?: string }) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // Honeypot chống bot: input ẩn, người thật không thấy/không điền
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const submit = async () => {
    setStatus("sending");
    setMessage("");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone, planInterest, website }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "Không gửi được, thử lại");
        return;
      }
      setStatus("done");
      setMessage("Đã nhận! Chúng tôi sẽ gửi link dùng thử trong vài phút.");
    } catch {
      setStatus("error");
      setMessage("Lỗi mạng, thử lại sau");
    }
  };

  if (status === "done") {
    return (
      <div className="rounded-[16px] border border-emerald-200 bg-emerald-50 p-6 text-[13px] text-emerald-800">
        <div className="font-black text-[15px]">✓ {message}</div>
        <a href="/dashboard" className="mt-3 inline-flex h-9 px-4 rounded-full bg-emerald-600 text-white text-[12px] font-bold items-center">
          Vào Dashboard luôn →
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-[18px] border border-slate-200 bg-white p-5 md:p-6">
      <div className="text-[15px] font-black text-navy">Dùng thử miễn phí</div>
      <p className="mt-1 text-[12px] text-slate-500">
        20 tin/ngày, không cần thẻ. Nhận link truy cập qua email/Zalo.
      </p>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
        <Input
          type="email"
          placeholder="Email của bạn"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11 rounded-[12px]"
        />
        <Input
          type="tel"
          inputMode="tel"
          placeholder="SĐT (không bắt buộc)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="h-11 rounded-[12px]"
        />
        {/* Bẫy bot: ẩn với người dùng, bot tự điền sẽ bị server từ chối ngầm */}
        <input
          type="text"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          autoComplete="off"
          tabIndex={-1}
          aria-hidden="true"
          className="absolute -left-[9999px] h-px w-px opacity-0"
        />
        <Button
          type="button"
          onClick={submit}
          disabled={status === "sending" || !email.includes("@")}
          className="h-11 px-6 rounded-[12px] text-[13px] font-bold"
        >
          {status === "sending" ? "Đang gửi..." : "Dùng thử"}
        </Button>
      </div>

      {message && status === "error" && <p className="mt-2 text-[12px] text-red-600">{message}</p>}
    </div>
  );
}
