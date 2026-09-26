import Link from "next/link";
import { Logo } from "@/components/site/logo";

// Footer cuối trang: brand + điều hướng + cam kết dữ liệu
export function SiteFooter() {
  return (
    <footer className="bg-navy text-slate-300">
      <div className="mx-auto max-w-[1120px] px-5 md:px-8 py-10 md:py-12">
        <div className="flex flex-col md:flex-row gap-8 md:items-start justify-between">
          <div className="max-w-[320px]">
            <Logo height={26} />
            <p className="mt-4 text-[12px] leading-relaxed text-slate-400">
              Tool chấm điểm kèo bất động sản cho môi giới Việt Nam — phát hiện bán gấp,
              so sánh giá, đánh giá pháp lý trong vài giây.
            </p>
          </div>

          <div className="flex gap-12 md:gap-16 text-[13px]">
            <div>
              <div className="text-[11px] font-black tracking-[0.16em] text-slate-500 mb-3">SẢN PHẨM</div>
              <div className="flex flex-col gap-2.5">
                <Link href="#tinh-nang" className="hover:text-white transition">Tính năng</Link>
                <Link href="/pricing" className="hover:text-white transition">Bảng giá</Link>
                <Link href="/dashboard" className="hover:text-white transition">Dashboard</Link>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-black tracking-[0.16em] text-slate-500 mb-3">HỖ TRỢ</div>
              <div className="flex flex-col gap-2.5">
                <Link href="#faq" className="hover:text-white transition">Câu hỏi thường gặp</Link>
                <Link href="/login" className="hover:text-white transition">Đăng nhập</Link>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-white/10 flex flex-col md:flex-row gap-2 items-start md:items-center justify-between text-[11px] text-slate-500">
          <div>© 2026 CheckBDS.online — AI hỗ trợ lọc tin, quyết định mua bán luôn cần kiểm chứng sổ + quy hoạch.</div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Tin của bạn chỉ dùng để chấm điểm, không chia sẻ
          </div>
        </div>
      </div>
    </footer>
  );
}
