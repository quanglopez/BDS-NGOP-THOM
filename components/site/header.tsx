import Link from "next/link";
import { Logo } from "@/components/site/logo";

const NAV = [
  { href: "#tinh-nang", label: "Tính năng" },
  { href: "#cach-hoat-dong", label: "Cách hoạt động" },
  { href: "#bang-gia", label: "Bảng giá" },
  { href: "#faq", label: "FAQ" },
];

// Header: nav gọn + CTA chính thống nhất "Dùng miễn phí"
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-navy/90 border-b border-white/10">
      <div className="mx-auto max-w-[1120px] px-5 md:px-8 h-[64px] flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center shrink-0">
          <Logo height={24} />
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-[13px] font-semibold text-slate-300">
          {NAV.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className="px-3 py-2 rounded-lg hover:text-white hover:bg-white/10 transition"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden sm:inline-flex h-10 px-3 items-center text-[13px] font-semibold text-slate-200 hover:text-white transition"
          >
            Đăng nhập
          </Link>
          <Link
            href="/#kiem-tra"
            className="h-10 px-5 rounded-[10px] bg-gradient-to-r from-[#C9A86A] to-[#d8ba7f] text-navy text-[13px] font-black flex items-center hover:from-[#d8ba7f] hover:to-[#e3ca92] transition"
          >
            Dùng miễn phí
          </Link>
        </div>
      </div>
    </header>
  );
}
