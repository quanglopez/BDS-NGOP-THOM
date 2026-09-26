import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Điều khoản sử dụng – CheckBDS.online",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-cream">
      <div className="mx-auto max-w-[760px] px-5 md:px-8 py-12">
        <Link href="/" className="text-[13px] font-bold text-navy hover:underline">
          ← Về trang chủ
        </Link>
        <h1 className="mt-6 text-[28px] font-black text-navy">Điều khoản sử dụng</h1>
        <p className="mt-2 text-[12px] text-slate-400">Cập nhật lần cuối: 26/09/2026</p>

        <div className="mt-8 space-y-6 text-[14px] leading-[1.8] text-slate-600">
          <section>
            <h2 className="text-[15px] font-black text-navy">1. Về dịch vụ</h2>
            <p className="mt-2">
              CheckBDS.online là công cụ hỗ trợ lọc và đánh giá tin rao bất động sản dựa trên mô hình AI.
              Kết quả mang tính tham khảo, không phải tư vấn đầu tư và không thay thế việc kiểm chứng
              thực tế.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-black text-navy">2. Trách nhiệm của người dùng</h2>
            <p className="mt-2">
              Bạn tự chịu trách nhiệm khi quyết định mua bán. Mọi giao dịch cần được kiểm chứng sổ đỏ,
              quy hoạch và hiện trạng thực tế trước khi xuống tiền.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-black text-navy">3. Sử dụng hợp lệ</h2>
            <p className="mt-2">
              Không dùng công cụ để phát tán nội dung vi phạm pháp luật, spam, hoặc truy cập trái phép
              hệ thống. Chúng tôi có quyền ngừng cung cấp dịch vụ khi phát hiện lạm dụng.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-black text-navy">4. Gói dịch vụ</h2>
            <p className="mt-2">
              Gói Free có giới hạn 20 tin/ngày. Gói PRO có giới hạn 500 tin/ngày. Gói không tự động
              gia hạn; khi hết hạn hệ thống tự chuyển về gói Free.
            </p>
          </section>
          <section>
            <h2 className="text-[15px] font-black text-navy">5. Thay đổi điều khoản</h2>
            <p className="mt-2">
              Điều khoản có thể được cập nhật. Thay đổi quan trọng sẽ được thông báo trên trang này.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
