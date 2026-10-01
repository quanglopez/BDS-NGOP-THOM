import type { Metadata } from "next";

/**
 * Layout riêng cho `/pricing` — tồn tại CHỈ để khai canonical.
 *
 * `app/pricing/page.tsx` là Client Component (cần `useState` cho bộ chọn số
 * tháng), nên không thể `export const metadata`. Metadata chỉ export được từ
 * Server Component, nên phải đặt ở layout cùng cấp.
 *
 * Cố ý KHÔNG khai `title` / `description` / `robots` ở đây: `/pricing`
 * đang kế thừa chúng từ `app/layout.tsx` và task này không đổi nội dung đó.
 * Chỉ thêm `alternates` để route có canonical của chính nó.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/pricing" },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}