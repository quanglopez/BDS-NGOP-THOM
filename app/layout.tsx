import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Ga4 } from "@/components/site/ga4";

/**
 * Font tải qua next/font: tự host, không render-blocking, không gọi
 * fonts.googleapis.com lúc render. `adjustFontFallback` giảm CLS khi font
 * chưa sẵn sàng. Biến CSS được expose để `app/globals.css` trỏ tới.
 *
 * Class variable PHẢI nằm trên `<html>`, không phải `<body>`: `app/globals.css`
 * khai `--cb-font-display` / `--cb-font-body` ở `:root` (= `<html>`), mà
 * chúng gọi `var(--font-display)` / `var(--font-body)`. `var()` chỉ nhìn thấy
 * biến ở chính element khai báo và các descendant — nếu `--font-*` chỉ có trên
 * `<body>` thì ở `<html>` không tồn tại, `--cb-font-*` thành guaranteed-invalid
 * và toàn bộ site rơi về font serif của trình duyệt. Preflight của Tailwind
 * cũng đặt `font-family: var(--cb-font-body)` ngay trên `html`, nên scope
 * phải khớp từ gốc.
 */
const inter = Inter({
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-body",
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "vietnamese"],
  display: "swap",
  weight: ["600", "700", "800"],
  variable: "--font-display",
});

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://checkbds.online").replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Check BĐS Ngộp Toàn Quốc - AI lọc kèo thơm 1 phút",
  description:
    "Dán tin BĐS ở bất kỳ đâu, AI chấm điểm tiềm năng đầu tư: phát hiện bán gấp ngộp, so sánh giá thị trường, đánh giá pháp lý. Hỗ trợ 63 tỉnh/thành, Bulk Check 100 tin, xuất Excel.",
  keywords: [
    "BĐS Việt Nam",
    "kèo ngộp",
    "nhà ngộp ngân hàng",
    "check tin BĐS",
    "AI bất động sản",
    "môi giới bất động sản",
    "BĐS Hà Nội",
    "BĐS TP.HCM",
    "BĐS Đà Nẵng",
    "BĐS Hải Phòng",
    "BĐS Cần Thơ",
    "BĐS Nha Trang",
  ],
  // KHÔNG đặt `alternates.canonical` ở đây.
  //
  // `canonical` là metadata kế thừa được: đặt ở root layout thì MỌI route con
  // đều nhận, kể cả route có trang riêng. Kết quả `/pricing`, `/lien-he`,
  // `/dieu-khoan`, `/hoan-tien`, `/bao-mat`, `/login` đều tự khai canonical
  // trỏ về trang chủ — bảy trang indexable tranh nhau một URL.
  //
  // Mỗi route public tự khai canonical của chính nó (xem `app/page.tsx` và
  // từng `*/page.tsx`). Route private/noindex (`/dashboard`, `/admin`,
  // `/bao-cao/*`) cố ý không có canonical.
  openGraph: {
    title: "Check BĐS Ngộp Toàn Quốc - AI lọc kèo thơm 1 phút",
    description: "Môi giới cả nước lọc 100 tin hàng loạt - không bỏ lỡ kèo ngộp",
    url: siteUrl,
    siteName: "BĐS Ngộp Thơm",
    locale: "vi_VN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Check BĐS Ngộp Toàn Quốc - AI lọc kèo thơm",
    description: "Dán tin BĐS, AI chấm điểm 6 tiêu chí, lọc kèo ngộp >80 điểm.",
  },
  robots: { index: true, follow: true },
  icons: { icon: "/logo-mark.png", apple: "/logo-mark.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${inter.variable} ${plusJakarta.variable}`}>
      <body className="min-h-screen bg-cream text-slate-800 selection:bg-gold/30 antialiased">
        <Ga4 />
        {children}
      </body>
    </html>
  );
}
