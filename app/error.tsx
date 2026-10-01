"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Error boundary cấp route — thay trang lỗi mặc định của Next.js.
 *
 * Bắt buộc là Client Component (Next truyền vào `error` + `reset`). Không được
 * export `metadata` ở đây vì file đã là client component.
 *
 * Ràng buộc: chỉ dùng token có sẵn, không thêm dependency, không đụng API/auth.
 * `error.digest` là mã do Next sinh — hiện cho người dùng dạng mã tham chiếu
 * để báo lỗi mà không làm lộ stack trace hay chi tiết hệ thống.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Ghi ra console để chủ site thấy được lỗi thật khi đang debug.
  useEffect(() => {
    console.error("Route error:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col bg-cream">
      <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col items-center justify-center px-5 py-14 md:px-8 md:py-20">
        {/* Dấu hiệu cảnh báo: hình khối CSS thuần, không dùng emoji — emoji
            render mỗi hệ một kiểu và không kiểm soát được màu trên nền navy. */}
        <div
          aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-pill bg-navy-900 shadow-lift"
        >
          <span className="font-display text-h3 text-gold-base">!</span>
        </div>

        <div className="mt-8 flex max-w-[560px] flex-col items-center text-center">
          <h1 className="font-display text-h2 text-navy-900">
            Có lỗi xảy ra
          </h1>
          <p className="mt-4 text-lead text-ink-600">
            Trang này gặp sự cố khi tải dữ liệu. Bạn có thể thử tải lại — tin
            đã lưu trong tài khoản vẫn còn nguyên.
          </p>

          {error.digest ? (
            <p className="mt-4 text-micro text-ink-500">
              Mã lỗi: <span className="font-mono">{error.digest}</span>
            </p>
          ) : null}
        </div>

        <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
          {/* Nút thử lại — chạy lại render của route, không reload cả trang. */}
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex h-[54px] w-full cursor-pointer items-center justify-center rounded-md bg-gold-base px-9 text-body font-bold text-navy-900 shadow-lift transition-colors duration-micro ease-cb hover:bg-gold-soft sm:w-auto"
          >
            Thử lại
          </button>
          <Link
            href="/"
            className="inline-flex h-[54px] w-full items-center justify-center rounded-md border border-line-strong bg-white px-9 text-body font-bold text-navy-900 transition-colors duration-micro ease-cb hover:bg-surface-mist sm:w-auto"
          >
            Về trang chủ
          </Link>
        </div>

        <p className="mt-10 text-small text-ink-500">
          Lỗi vẫn lặp lại?{" "}
          <Link
            href="/lien-he"
            className="font-bold text-navy-900 underline underline-offset-4"
          >
            Liên hệ hỗ trợ
          </Link>
        </p>
      </div>
    </main>
  );
}
