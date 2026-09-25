import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { PaymentBox } from "@/components/pricing/payment-box";

export const metadata: Metadata = {
  title: "Bảng giá - Check BĐS Ngộp Vũng Tàu",
  description: "Gói Free 20 tin/ngày, Pro 299k/tháng 500 tin/ngày + Bulk Check, Team 799k/tháng cho 3 môi giới.",
};

const FEATURES: Record<string, string[]> = {
  free: ["20 tin check/ngày", "Phân tích AI 6 chỉ số", "Lịch sử 100 tin", "Chấm điểm local khi hết lượt"],
  pro: [
    "500 tin check/ngày",
    "Bulk Check 100 tin/lần",
    "Xuất Excel kèo ngon",
    "Lọc kèo >80 điểm",
    "Hỗ trợ ưu tiên Zalo/SĐT",
  ],
  team: ["Tất cả tính năng Pro", "3 tài khoản môi giới", "500 tin/ngày mỗi tài khoản", "Quản lý team (sắp có)"],
};

// Trang bảng giá: 3 gói + thanh toán VietQR/SePay
export default function PricingPage() {
  const plans = [
    { key: "free", label: "FREE", price: "0đ", sub: "Dùng thử", limit: "20 tin/ngày", highlight: false },
    { key: "pro", label: "PRO", price: "299k", sub: "/ tháng", limit: "500 tin/ngày", highlight: true },
    { key: "team", label: "TEAM", price: "799k", sub: "/ tháng", limit: "3 tài khoản", highlight: false },
  ] as const;

  return (
    <main className="min-h-screen bg-cream">
      <SiteHeader />

      <section className="mx-auto max-w-[1120px] px-5 md:px-8 pt-12 pb-8">
        <div className="text-center max-w-[620px] mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-navy text-white text-[11px] font-bold tracking-widest">
            BẢNG GIÁ
          </div>
          <h1 className="mt-4 text-[28px] md:text-[40px] font-black leading-[1.05] tracking-tight text-navy">
            Đầu tư 299k/tháng để không bỏ lỡ kèo ngộp
          </h1>
          <p className="mt-3 text-[14px] text-slate-500">
            1 kèo ngộp ngon = vài trăm triệu biên lợi nhuận. Giá gói Pro = 1 ly cà phê mỗi ngày.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
          {plans.map((p) => (
            <div
              key={p.key}
              className={`rounded-[20px] p-6 border-2 ${
                p.highlight ? "border-navy bg-navy text-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.4)]" : "border-slate-200 bg-white"
              }`}
            >
              <div className={`text-[12px] font-black tracking-widest ${p.highlight ? "text-gold" : "text-slate-500"}`}>
                {p.label}
                {p.highlight && (
                  <span className="ml-2 px-2 py-0.5 rounded-full bg-gold text-navy text-[10px]">PHỔ BIẾN</span>
                )}
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <div className={`text-[36px] font-black ${p.highlight ? "text-white" : "text-navy"}`}>{p.price}</div>
                <div className={`text-[13px] ${p.highlight ? "text-slate-300" : "text-slate-500"}`}>{p.sub}</div>
              </div>
              <div className={`mt-1 text-[12px] font-semibold ${p.highlight ? "text-gold" : "text-slate-500"}`}>
                {p.limit}
              </div>

              <ul className="mt-5 space-y-2">
                {FEATURES[p.key].map((f) => (
                  <li key={f} className="flex gap-2 text-[13px]">
                    <span className={p.highlight ? "text-gold" : "text-emerald-600"}>✓</span>
                    <span className={p.highlight ? "text-slate-200" : "text-slate-600"}>{f}</span>
                  </li>
                ))}
              </ul>

              {p.key === "free" ? (
                <Link
                  href="/dashboard"
                  className="mt-6 w-full h-[44px] rounded-[12px] border border-slate-200 bg-white hover:bg-slate-50 text-[14px] font-bold text-slate-700 flex items-center justify-center transition"
                >
                  Dùng thử miễn phí
                </Link>
              ) : (
                <a
                  href="#thanhtoan"
                  className="mt-6 w-full h-[44px] rounded-[12px] bg-gold hover:bg-[#d4b678] text-navy text-[14px] font-bold flex items-center justify-center transition"
                >
                  Nâng cấp {p.label}
                </a>
              )}
            </div>
          ))}
        </div>

        <div id="thanhtoan" className="mt-12">
          <PaymentBox />
        </div>

        <div className="mt-12 rounded-[18px] border border-slate-200 bg-white p-6">
          <h2 className="text-[18px] font-black text-navy">Câu hỏi thường gặp</h2>
          <div className="mt-4 space-y-4 text-[13px]">
            <div>
              <div className="font-bold text-slate-800">AI dùng ở đây là gì? Có chính xác không?</div>
              <p className="mt-1 text-slate-500 leading-relaxed">
                Tool dùng mô hình AI (Jev) chấm điểm 6 tiêu chí: độ ngộp, tăng giá, thanh khoản, pháp lý, giá thị
                trường, vị trí. Độ chính xác ~85% với tin đầy đủ thông tin — AI là trợ lý lọc tin, quyết định mua vẫn
                do môi giới kiểm chứng sổ + quy hoạch.
              </p>
            </div>
            <div>
              <div className="font-bold text-slate-800">Chi phí token $0.042/1M nghĩa là sao?</div>
              <p className="mt-1 text-slate-500 leading-relaxed">
                Mỗi tin check tốn rất ít token (vài nghìn) — tương đương chưa tới 10đ/tin. Giá gói Pro 299k/tháng gồm
                chi phí hạ tầng, vận hành và hỗ trợ.
              </p>
            </div>
            <div>
              <div className="font-bold text-slate-800">Thanh toán thế nào? Có hoàn tiền không?</div>
              <p className="mt-1 text-slate-500 leading-relaxed">
                Chuyển khoản VietQR (SePay) với nội dung <b>NANGCAP</b> + mã tài khoản. Hệ thống tự nâng gói trong 1-2
                phút. Hoàn tiền 100% trong 3 ngày đầu nếu tool không hữu ích.
              </p>
            </div>
            <div>
              <div className="font-bold text-slate-800">Tin rao của tôi có bị lưu không?</div>
              <p className="mt-1 text-slate-500 leading-relaxed">
                Chỉ lưu điểm số + loại kèo để bạn xem lịch sử. Nội dung tin được giữ tối đa 6.000 ký tự cho việc chấm
                điểm, không chia sẻ cho bên thứ ba.
              </p>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
