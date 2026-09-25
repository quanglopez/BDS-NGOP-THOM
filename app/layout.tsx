import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Check BĐS Ngộp Vũng Tàu - AI lọc kèo thơm 1 phút",
  description:
    "Dán tin BĐS Vũng Tàu, AI chấm điểm tiềm năng đầu tư trong 1s: phát hiện bán gấp ngộp, so sánh giá thị trường, đánh giá pháp lý.",
  keywords: [
    "BĐS Vũng Tàu",
    "kèo ngộp",
    "nhà ngộp ngân hàng",
    "check tin BĐS",
    "AI bất động sản",
    "môi giới Vũng Tàu",
  ],
  openGraph: {
    title: "Check BĐS Ngộp Vũng Tàu - AI lọc kèo thơm 1 phút",
    description: "Môi giới Vũng Tàu lọc 100 tin trong 1 phút - Không bỏ lỡ kèo ngộp",
    locale: "vi_VN",
    type: "website",
  },
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
