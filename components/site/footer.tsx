import Link from "next/link";
import { Lock } from "lucide-react";
import { Logo } from "@/components/site/logo";

const SẢN_PHẨM = [
  { href: "#tinh-nang", label: "Tính năng" },
  { href: "#cach-hoat-dong", label: "Cách hoạt động" },
  { href: "#bang-gia", label: "Bảng giá" },
  { href: "/dashboard", label: "Dashboard" },
];

const HỖ_TRỢ = [
  { href: "#faq", label: "Câu hỏi thường gặp" },
  { href: "/lien-he", label: "Liên hệ" },
  { href: "/login", label: "Đăng nhập" },
];

const PHÁP_LÝ = [
  { href: "/dieu-khoan", label: "Điều khoản sử dụng" },
  { href: "/bao-mat", label: "Chính sách bảo mật" },
  { href: "/hoan-tien", label: "Chính sách hoàn tiền" },
];

// Footer: điều hướng + link pháp lý + cam kết dữ liệu
export function SiteFooter() {
  return (
    <footer className="bg-navy text-slate-300">
      <div className="mx-auto max-w-[1120px] px-5 md:px-8 py-10 md:py-12">
        <div className="flex flex-col md:flex-row gap-8 md:items-start justify-between">
          <div className="max-w-[320px]">
            <Logo height={26} />
            <p className="mt-4 text-small text-slate-400">
              Công cụ lọc tin bất động sản cho môi giới Việt Nam — phát hiện bán gấp, so sánh giá,
              đánh giá pháp lý trong vài giây.
            </p>
            <div className="mt-4 flex items-center gap-1.5 text-small text-slate-400">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Thanh toán an toàn • Hoàn
              tiền 100% trong 3 ngày
            </div>
          </div>

          <div className="flex flex-wrap gap-10 md:gap-14 text-small">
            <div>
              <div className="text-micro font-bold tracking-widest text-ink-on-navy-faint mb-3">SẢN PHẨM</div>
              <div className="flex flex-col gap-6">
                {SẢN_PHẨM.map((l) => (
                  <Link key={l.label} href={l.href} className="-my-3 py-3.5 hover:text-white transition">
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <div className="text-micro font-bold tracking-widest text-ink-on-navy-faint mb-3">HỖ TRỢ</div>
              <div className="flex flex-col gap-6">
                {HỖ_TRỢ.map((l) => (
                  <Link key={l.label} href={l.href} className="-my-3 py-3.5 hover:text-white transition">
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <div className="text-micro font-bold tracking-widest text-ink-on-navy-faint mb-3">PHÁP LÝ</div>
              <div className="flex flex-col gap-6">
                {PHÁP_LÝ.map((l) => (
                  <Link key={l.label} href={l.href} className="-my-3 py-3.5 hover:text-white transition">
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-white/10 flex flex-col md:flex-row gap-2 items-start md:items-center justify-between text-micro text-slate-500">
          <div>© 2026 CheckBDS.online — AI hỗ trợ lọc tin, quyết định mua bán luôn cần kiểm chứng sổ + quy hoạch.</div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-pill bg-emerald-400" />
            Tin của bạn chỉ dùng để chấm điểm, không chia sẻ
          </div>
        </div>
      </div>
    </footer>
  );
}
