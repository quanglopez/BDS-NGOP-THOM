"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// Thẻ affiliate: mã giới thiệu + link chia sẻ, giới thiệu 1 bạn = +10 check
export function ReferralCard() {
  const [info, setInfo] = useState<{ code: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/referral");
      if (res.ok) {
        const data = await res.json();
        setInfo({ code: data.code, link: data.link });
      }
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!info) return;
    await navigator.clipboard.writeText(info.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-8 rounded-[18px] border border-gold bg-gradient-to-br from-navy to-[#162E5E] text-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold tracking-[0.14em] text-gold">GIỚI THIỆU BẠN BÈ</div>
          <div className="mt-2 text-[16px] font-black">
            Giới thiệu 1 môi giới → cả 2 cùng có +10 check free
          </div>
          <div className="mt-1 text-[12px] text-slate-300">
            Chia sẻ link, bạn bè đăng nhập bằng link đó là bạn được cộng check ngay.
          </div>
        </div>

        {info ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="px-3 py-2 rounded-[10px] bg-white/10 border border-white/20 text-[12px] font-bold">
              {info.link}
            </code>
            <Button
              type="button"
              onClick={copy}
              className="h-9 px-4 rounded-full bg-gold text-navy text-[12px] font-bold"
            >
              {copied ? "Đã copy" : "Copy link"}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            onClick={load}
            disabled={loading}
            className="h-10 px-5 rounded-full bg-gold text-navy text-[13px] font-bold"
          >
            {loading ? "Đang tạo..." : "Lấy link giới thiệu"}
          </Button>
        )}
      </div>
    </div>
  );
}
