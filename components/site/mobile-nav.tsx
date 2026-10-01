"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X, ArrowRight } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

export type NavLink = { href: string; label: string };

// Đường dẫn phụ chỉ có ở mobile — desktop đã vào được qua header + footer.
const SECONDARY: NavLink[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/lien-he", label: "Liên hệ" },
];

/**
 * Menu mobile. Trước đây nav desktop bị ẩn hoàn toàn dưới `md` nên trên
 * mobile không tới được Tính năng / Cách hoạt động / Bảng giá / FAQ.
 *
 * Không thêm dependency: đóng bằng Escape, khoá scroll nền, trả focus về
 * nút mở. Không đụng business logic của trang — chỉ điều hướng.
 */
export function MobileNav({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    // Khoá scroll nền khi menu mở, trả lại nguyên trạng khi đóng.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="cb-mobile-nav"
        aria-label={open ? "Đóng menu" : "Mở menu"}
        className="md:hidden h-11 w-11 -mr-2 flex items-center justify-center rounded-md text-slate-100 hover:bg-white/10 transition-colors duration-micro ease-cb"
      >
        {open ? <X size={22} strokeWidth={1.75} /> : <Menu size={22} strokeWidth={1.75} />}
      </button>

      {open ? (
        <div className="md:hidden fixed inset-x-0 top-16 z-40">
          <div
            className="absolute inset-0 bg-navy-900/70"
            onClick={close}
            aria-hidden="true"
          />

          <div
            id="cb-mobile-nav"
            className="animate-in fade-in-0 slide-in-from-top-2 relative border-t border-line-navy bg-navy-800 px-5 pb-8 pt-3 duration-base"
          >
            <nav className="flex flex-col" aria-label="Điều hướng chính">
              {links.map((l) => (
                <Link
                  key={l.label}
                  href={l.href}
                  onClick={close}
                  className="flex h-12 items-center justify-between border-b border-line-navy text-[15px] font-semibold text-slate-100 transition-colors duration-micro ease-cb hover:text-white"
                >
                  {l.label}
                  <ArrowRight size={16} strokeWidth={1.75} className="text-gold-deep" />
                </Link>
              ))}
            </nav>

            <nav
              className="mt-3 flex flex-col"
              aria-label="Đường dẫn phụ"
            >
              {SECONDARY.map((l) => (
                <Link
                  key={l.label}
                  href={l.href}
                  onClick={close}
                  className="flex h-11 items-center text-small font-medium text-slate-300 transition-colors duration-micro ease-cb hover:text-white"
                >
                  {l.label}
                </Link>
              ))}
              <Link
                href="/login"
                onClick={close}
                className="flex h-11 items-center text-small font-medium text-slate-300 transition-colors duration-micro ease-cb hover:text-white"
              >
                Đăng nhập
              </Link>
            </nav>

            <Link
              href="/#kiem-tra"
              onClick={() => {
                trackEvent("cta_clicked", { cta: "mobile_nav_primary" });
                close();
              }}
              className="mt-5 flex h-12 w-full items-center justify-center rounded-md bg-gold-base text-body font-bold text-navy-900 shadow-lift transition-colors duration-micro ease-cb hover:bg-gold-soft"
            >
              Dùng miễn phí – 20 tin/ngày
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
