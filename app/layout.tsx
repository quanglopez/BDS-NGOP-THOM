import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://check-bds-ngop.vercel.app").replace(/\/$/, "");

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
  alternates: { canonical: "/" },
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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-cream text-slate-800 selection:bg-gold/30 antialiased">
        {children}
      </body>
    </html>
  );
}
