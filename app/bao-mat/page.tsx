import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Chính sách bảo mật – CheckBDS.online",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-cream">
      <div className="mx-auto max-w-[760px] px-5 md:px-8 py-12">
        <Link href="/" className="text-[13px] font-bold text-navy hover:underline">
          ← Về trang chủ
        </Link>
        <h1 className="mt-6 text-[28px] font-black text-navy">Chính sách bảo mật</h1>
        <p className="mt-2 text-[12px] text-slate-400">Cập nhật lần cuối: 26/09/2026</p>

        <div className="mt-8 space-y-6 text-[14px] leading-[1.8] text-slate-600">
          <section>
            <h2 className="text-[15px] font-black text-navy">1. Chúng tôi thu thập gì</h2>
            <p className="mt-2">
              Tài khoản Google (email, tên) khi bạn đăng nhập. Nội dung tin rao bạn dán vào để chấm
              điểm. Điểm số và link tin được lưu vào lịch sử của riêng bạn.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-black text-navy">2. Chúng tôi không làm gì</h2>
            <p className="mt-2">
              Không bán dữ liệu của bạn cho bên thứ ba. Không chia sẻ nội dung tin bạn nhập với người
              khác. Không dùng nội dung tin của bạn để huấn luyện mô hình.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-black text-navy">3. Cookie và đo lường</h2>
            <p className="mt-2">
              Chúng tôi dùng cookie để duy trì phiên đăng nhập, và công cụ đo lường ẩn danh để biết
              trang nào hữu ích (số lượt xem, số lần check).
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-black text-navy">4. Thanh toán</h2>
            <p className="mt-2">
              Thanh toán qua chuyển khoản ngân hàng. Chúng tôi không lưu thông tin thẻ hay tài khoản
              ngân hàng của bạn.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-black text-navy">5. Quyền của bạn</h2>
            <p className="mt-2">
              Yêu cầu xóa tài khoản và toàn bộ dữ liệu bất cứ lúc nào qua trang{" "}
              <Link href="/lien-he" className="font-bold text-navy underline">
                Liên hệ
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
