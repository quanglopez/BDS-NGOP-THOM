"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { trackEvent } from "@/lib/analytics";

// Đăng nhập Google — chỉ 1 nút, không form, không yêu cầu email/SĐT trước login
export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogle = async () => {
    setError("");
    setLoading(true);
    trackEvent("login_clicked", { from: "login_page" });
    try {
      const supabase = createClient();
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (err) setError(err.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không kết nối được máy chủ");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-[18px] bg-white p-6 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.5)]">
      <button
        type="button"
        onClick={handleGoogle}
        disabled={loading}
        className="w-full h-[52px] rounded-[12px] bg-gradient-to-r from-[#C9A86A] to-[#d8ba7f] text-navy text-[15px] font-black flex items-center justify-center gap-3 hover:from-[#d8ba7f] hover:to-[#e3ca92] transition disabled:opacity-60"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
          />
        </svg>
        {loading ? "Đang chuyển tới Google..." : "Đăng nhập bằng Google"}
      </button>

      <p className="mt-4 text-center text-[12px] text-slate-500">
        Miễn phí 20 tin/ngày • Không cần thẻ • Không cần nhập SĐT
      </p>

      {error && <p className="mt-3 text-[12px] text-red-600 text-center">{error}</p>}

      <p className="mt-4 text-[11px] text-slate-400 leading-snug text-center">
        Bằng việc đăng nhập, bạn đồng ý{" "}
        <a href="/dieu-khoan" className="font-semibold text-navy hover:underline">
          điều khoản sử dụng
        </a>{" "}
        và{" "}
        <a href="/bao-mat" className="font-semibold text-navy hover:underline">
          chính sách bảo mật
        </a>
        .
      </p>
    </div>
  );
}
