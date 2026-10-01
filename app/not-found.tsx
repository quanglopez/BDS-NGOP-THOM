import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/site/logo";

/**
 * 404 có thương hiệu — thay trang mặc định của Next.js (tiếng Anh, không có
 * CSS nên mất cả font lẫn layout).
 *
 * Chỉ dùng token đã có trong design system: `bg-cream`, `navy-*`, `gold-*`,
 * `ink-*`, `line`, `rounded-*`, `shadow-*`, `text-*` (scale) và `ease-cb`.
 * Không khai token mới, không thêm ảnh minh hoạ, không bịa số liệu.
 */
export const metadata: Metadata = {
  title: "Không tìm thấy trang - CheckBDS.online",
  description: "Đường dẫn này không tồn tại hoặc đã được chuyển đi.",
  robots: { index: false, follow: true },
};

/**
 * Số "404" trang trí: mốc thị giác nói rõ đây là trang không tồn tại mà không
 * cần thêm ảnh minh hoạ. `aria-hidden` vì thông tin này đã nằm trong `<h1>`.
 */
function Code404() {
  return (
    <p
      aria-hidden="true"
      className="font-display text-display leading-none text-gold-base/25 select-none"
    >
      404
    </p>
  );
}

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col bg-cream">
      <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col items-center justify-center px-5 py-14 md:px-8 md:py-20">
        <Link
          href="/"
          aria-label="Về trang chủ CheckBDS.online"
          className="rounded-sm"
        >
          <Logo height={26} />
        </Link>

        <div className="mt-9 flex flex-col items-center text-center">
          {/* Số 404 là mốc trang trí: đứng riêng một dòng phía trên tiêu đề,
              không chồng lên chữ để không bị cắt và không gây CLS khi ẩn/hiện. */}
          <Code404 />

          <h1 className="mt-6 font-display text-h2 text-navy-900">
            Không tìm thấy trang này
          </h1>

          <p className="mt-4 max-w-[560px] text-lead text-ink-600">
            Có thể đường dẫn bị sai chính tả, trang đã được chuyển đi, hoặc
            liên kết bạn mở không còn tồn tại.
          </p>
        </div>

        {/* Đường quay lại: một hành động chính + một hành động phụ. */}
        <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
          <Link
            href="/"
            className="inline-flex h-[54px] w-full items-center justify-center rounded-md bg-gold-base px-9 text-body font-bold text-navy-900 shadow-lift transition-colors duration-micro ease-cb hover:bg-gold-soft sm:w-auto"
          >
            Về trang chủ
          </Link>
          <Link
            href="/lien-he"
            className="inline-flex h-[54px] w-full items-center justify-center rounded-md border border-line-strong bg-white px-9 text-body font-bold text-navy-900 transition-colors duration-micro ease-cb hover:bg-surface-mist sm:w-auto"
          >
            Liên hệ hỗ trợ
          </Link>
        </div>

        {/* Link phụ tới nơi người dùng thường cần, tránh bị bỏ đứng ở trang chết. */}
        <nav
          aria-label="Liên kết tới các trang khác"
          className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3"
        >
          <Link
            href="/dieu-khoan"
            className="text-small text-ink-500 transition-colors duration-micro ease-cb hover:text-navy-900"
          >
            Điều khoản sử dụng
          </Link>
          <Link
            href="/bao-mat"
            className="text-small text-ink-500 transition-colors duration-micro ease-cb hover:text-navy-900"
          >
            Chính sách bảo mật
          </Link>
          <Link
            href="/hoan-tien"
            className="text-small text-ink-500 transition-colors duration-micro ease-cb hover:text-navy-900"
          >
            Chính sách hoàn tiền
          </Link>
        </nav>
      </div>
    </main>
  );
}
