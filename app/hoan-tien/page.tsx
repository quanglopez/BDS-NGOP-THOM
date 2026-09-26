import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Chính sách hoàn tiền – CheckBDS.online",
  robots: { index: true, follow: true },
};

export default function RefundPage() {
  return (
    <main className="min-h-screen bg-cream">
      <div className="mx-auto max-w-[760px] px-5 md:px-8 py-12">
        <Link href="/" className="text-[13px] font-bold text-navy hover:underline">
          ← Về trang chủ
        </Link>
        <h1 className="mt-6 text-[28px] font-black text-navy">Chính sách hoàn tiền</h1>
        <p className="mt-2 text-[12px] text-slate-400">Cập nhật lần cuối: 26/09/2026</p>

        <div className="mt-8 space-y-6 text-[14px] leading-[1.8] text-slate-600">
          <section>
            <h2 className="text-[15px] font-black text-navy">Hoàn tiền 100% trong 3 ngày</h2>
            <p className="mt-2">
              Nếu gói PRO không hữu ích cho công việc của bạn trong 3 ngày đầu, liên hệ hỗ trợ để được
              hoàn tiền 100% — không hỏi lý do, không điều kiện thêm.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-black text-navy">Cách yêu cầu</h2>
            <p className="mt-2">
              Gửi yêu cầu qua trang{" "}
              <Link href="/lien-he" className="font-bold text-navy underline">
                Liên hệ
              </Link>{" "}
              kèm email tài khoản và nội dung CK (nếu có). Xử lý trong 24 giờ làm việc, tiền về tài
              khoản đã chuyển trong 2–5 ngày tùy ngân hàng.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-black text-navy">Trường hợp không áp dụng</h2>
            <p className="mt-2">
              Yêu cầu sau 3 ngày kể từ khi nâng cấp, hoặc tài khoản vi phạm điều khoản sử dụng.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-black text-navy">Không tự động gia hạn</h2>
            <p className="mt-2">
              Gói PRO không tự động gia hạn. Hết hạn hệ thống tự chuyển về gói Free — bạn không bị trừ
              tiền lần nào nữa cho tới khi chủ động mua thêm.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
