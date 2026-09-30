"use client";

import Link from "next/link";
import { Logo } from "@/components/site/logo";
import { MobileNav, type NavLink } from "@/components/site/mobile-nav";
import { trackEvent } from "@/lib/analytics";

const NAV: NavLink[] = [
  { href: "#tinh-nang", label: "Tính năng" },
  { href: "#cach-hoat-dong", label: "Cách hoạt động" },
  { href: "#bang-gia", label: "Bảng giá" },
  { href: "#faq", label: "FAQ" },
];

// Header: nav gọn + CTA chính thống nhất "Dùng miễn phí".
// Mobile: menu trượt xuống (MobileNav) vì nav desktop bị ẩn dưới `md`.
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line-navy bg-navy-900/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-4 px-5 md:px-8">
        <Link href="/" className="flex shrink-0 items-center">
          <Logo height={24} />
        </Link>

        <nav className="hidden items-center gap-1 text-small font-semibold text-slate-300 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className="rounded-md px-3 py-2 transition-colors duration-micro ease-cb hover:bg-white/10 hover:text-white"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="hidden h-11 items-center px-3 text-small font-semibold text-slate-200 transition-colors duration-micro ease-cb hover:text-white sm:inline-flex"
          >
            Đăng nhập
          </Link>

          <Link
            href="/#kiem-tra"
            onClick={() => trackEvent("cta_clicked", { cta: "header_primary" })}
            className="flex h-11 items-center rounded-md bg-gold-base px-5 text-small font-bold text-navy-900 transition-colors duration-micro ease-cb hover:bg-gold-soft"
          >
            Dùng miễn phí
          </Link>

          <MobileNav links={NAV} />
        </div>
      </div>
    </header>
  );
}
