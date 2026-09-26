import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Đăng nhập - Check BĐS Ngộp Toàn Quốc",
  description: "Đăng nhập bằng Google để dùng tool check kèo BĐS.",
};

const PERKS = [
  { icon: "🤖", title: "AI thật, không giới hạn công thức", desc: "Chấm 6 tiêu chí sâu thay vì ước tính nhanh" },
  { icon: "📦", title: "Bulk Check 100 tin/lần", desc: "Upload file Zalo, lọc kèo >80 điểm trong 1 phút" },
  { icon: "📊", title: "Lịch sử + thống kê", desc: "Mọi tin đã check lưu lại, xuất Excel khi cần" },
];

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-navy flex items-center justify-center px-5 py-12 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 30%, black 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 50% 30%, black 30%, transparent 75%)",
        }}
      />
      <div className="absolute -top-32 right-[-100px] w-[480px] h-[480px] bg-gold/15 rounded-full blur-[100px]" />

      <div className="relative w-full max-w-[880px] grid md:grid-cols-2 gap-8 md:gap-12 items-center">
        {/* Cột giới thiệu */}
        <div className="hidden md:block">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gold flex items-center justify-center text-navy font-black text-[15px] tracking-widest">
              AI
            </div>
            <div className="leading-none">
              <div className="font-extrabold text-[16px] tracking-tight text-white">BĐS NGỘP THƠM</div>
              <div className="text-[10px] tracking-[0.18em] font-semibold text-gold mt-[3px]">
                TOÀN QUỐC • AI SCORING
              </div>
            </div>
          </Link>

          <h1 className="mt-8 text-[32px] font-black leading-[1.1] tracking-tight text-white">
            Đăng nhập để mở khóa <span className="text-gold">AI thật</span>
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-slate-300">
            Miễn phí 20 tin/ngày. Không cần thẻ, chỉ cần tài khoản Google.
          </p>

          <div className="mt-7 space-y-4">
            {PERKS.map((p) => (
              <div key={p.title} className="flex gap-3.5">
                <span className="w-10 h-10 shrink-0 rounded-[12px] bg-white/10 border border-white/15 flex items-center justify-center text-[18px]">
                  {p.icon}
                </span>
                <div>
                  <div className="text-[14px] font-bold text-white">{p.title}</div>
                  <div className="mt-0.5 text-[12px] text-slate-400">{p.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cột form */}
        <div className="w-full max-w-[420px] mx-auto md:mx-0">
          <div className="md:hidden text-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-gold mx-auto flex items-center justify-center text-navy font-black text-[16px] tracking-widest">
              AI
            </div>
            <h1 className="mt-4 text-[22px] font-black text-white">BĐS NGỘP THƠM</h1>
            <p className="mt-1 text-[13px] text-slate-300">Đăng nhập để check kèo BĐS trên toàn quốc</p>
          </div>
          <Suspense>
            <LoginForm />
          </Suspense>
          <p className="mt-4 text-center text-[12px] text-slate-400">
            Chưa có tài khoản? Tài khoản tự tạo khi đăng nhập Google lần đầu.{" "}
            <Link href="/" className="text-gold font-semibold hover:underline">
              ← Về trang chủ
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
