import type { Metadata } from "next";

/**
 * Metadata riêng cho `/pricing`.
 *
 * `app/pricing/page.tsx` là Client Component (cần `useState` cho bộ chọn số
 * tháng và `PaymentBox`), nên không thể `export const metadata`. Metadata chỉ
 * export được từ Server Component, nên phải đặt ở layout cùng cấp.
 *
 * Trước đó route này kế thừa toàn bộ `title` / `description` / `openGraph` từ
 * `app/layout.tsx` — tức khoản giá lại mang tiêu đề chung của trang chủ.
 *
 * Mọi claim dưới đây lấy nguyên văn từ `app/pricing/page.tsx`:
 *   - h1        : "Chấm 500 tin/ngày, chỉ còn vài tin đáng gọi"
 *   - FREE      : "20 tin/ngày", "0đ / mãi mãi", "Không cần thẻ"
 *   - PRO       : "500 tin/ngày", "Bulk Check 100 tin/lần"
 *   - thanh toán: VietQR, "kích hoạt gói trong 1–2 phút"
 *   - điều khoản: "Hoàn tiền 100% trong 3 ngày", "Có thể hủy bất kỳ lúc nào"
 *
 * Cố ý KHÔNG đưa giá tiền cụ thể vào metadata: giá do `quotePrice(months)` tính
 * lúc render nên ghi cứng sẽ nhanh lỗi. Cũng không tạo ảnh OG mới — site chưa
 * có asset OG dùng chung, root layout cũng không khai `openGraph.images`.
 *
 * `twitter` cố ý khai ở đây: `openGraph` bị thay thế hoàn toàn (không merge sâu),
 * nên để twitter kế thừa sẽ ra OG là trang giá nhưng Twitter vẫn là trang chủ.
 */
export const metadata: Metadata = {
  title: "Bảng giá gói Free và PRO – CheckBDS.online",
  description:
    "Gói Free 20 tin/ngày miễn phí, không cần thẻ. Gói PRO 500 tin/ngày, Bulk Check 100 tin/lần, thanh toán VietQR kích hoạt trong 1–2 phút. Hoàn tiền 100% trong 3 ngày, hủy bất kỳ lúc nào.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Chấm 500 tin/ngày, chỉ còn vài tin đáng gọi",
    description:
      "Gói Free 20 tin/ngày miễn phí, không cần thẻ. Gói PRO 500 tin/ngày, Bulk Check 100 tin/lần, thanh toán VietQR kích hoạt trong 1–2 phút.",
    url: "/pricing",
    siteName: "BDS Ngộp Thơm",
    locale: "vi_VN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bảng giá gói Free và PRO – CheckBDS.online",
    description:
      "Free 20 tin/ngày miễn phí. PRO 500 tin/ngày, Bulk Check 100 tin/lần, VietQR kích hoạt 1–2 phút, hoàn tiền 100% trong 3 ngày.",
  },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}