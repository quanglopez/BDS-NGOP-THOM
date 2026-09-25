import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Đăng nhập - Check BĐS Ngộp Vũng Tàu",
  description: "Đăng nhập bằng Google để dùng tool check kèo BĐS.",
};

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-navy flex items-center justify-center px-5 py-12 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gold/10 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/3" />
      <div className="relative w-full max-w-[420px]">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/15 mx-auto flex items-center justify-center text-gold font-black text-[16px] tracking-widest">
            AI
          </div>
          <h1 className="mt-4 text-[22px] font-black text-white">BĐS NGỘP THƠM</h1>
          <p className="mt-1 text-[13px] text-slate-300">Đăng nhập để check kèo BĐS Vũng Tàu</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
