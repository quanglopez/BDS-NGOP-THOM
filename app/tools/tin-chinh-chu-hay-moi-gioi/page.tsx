import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { OwnerSignalClient } from "@/components/owner-signals/owner-signal-client";

const TITLE = "Tin chính chủ hay môi giới? Kiểm tra dấu hiệu | CheckBDS";

export const metadata: Metadata = {
  title: TITLE,
  description:
    "Dán nội dung tin đăng để xem các dấu hiệu trong cách viết nghiêng về người bán trực tiếp, môi giới, hay chưa đủ dữ liệu. CheckBDS chỉ phân tích câu chữ trong tin, không xác minh danh tính người bán.",
  alternates: { canonical: "/tools/tin-chinh-chu-hay-moi-gioi" },
  keywords: [
    "tin chính chủ hay môi giới",
    "phân tích tin đăng bất động sản",
    "dấu hiệu tin môi giới",
    "kiểm tra tin bất động sản",
    "nhận biết tin chính chủ",
  ],
  robots: { index: true, follow: true },
};

// FAQ chỉ vào structured data khi nội dung thật sự hiển thị trên trang.
const FAQS = [
  {
    q: "CheckBDS có xác minh chính chủ không?",
    a: "Không. Công cụ này chỉ đọc các dấu hiệu trong nội dung tin đăng và cho biết câu chữ nghiêng về hướng nào. Nó không xác minh danh tính người bán, không kiểm tra sổ, và không biết ai là người đứng tên tài sản.",
  },
  {
    q: "Vì sao tin ghi \"chính chủ\" vẫn có thể là môi giới?",
    a: "Vì \"chính chủ\" là lời tự khai trong nội dung tin. Bất kỳ ai đăng tin cũng có thể viết cụm này, kể cả bên bán hộ. Đây là lý do CheckBDS xếp cụm từ này vào nhóm dấu hiệu yếu và không dùng nó để kết luận.",
  },
  {
    q: "Kết quả có chính xác 100% không?",
    a: "Không có con số độ chính xác nào ở đây, và công cụ không đưa ra kết luận chắc chắn. Nội dung tin có thể được sao chép hoặc viết lại, nên một bên bán hộ hoàn toàn có thể dùng lại câu chữ của người bán trực tiếp. Kết quả chỉ là gợi ý để bạn hỏi thêm.",
  },
  {
    q: "Tôi nên hỏi gì trước khi đi xem?",
    a: "Nên hỏi trực tiếp người đứng tên trên sổ: ai đứng tên, có thể gặp người đứng tên không, căn này còn bán đúng giá trong tin không, và ngoài căn này còn căn nào khác đang bán không. Kết quả phân tích có sẵn danh sách câu hỏi để bạn dùng khi gọi.",
  },
  {
    q: "CheckBDS có tra cứu số điện thoại người bán không?",
    a: "Không. Công cụ không tra cứu số điện thoại, không tra ngược số điện thoại, không tìm kiếm thông tin người đăng trên internet, và không dùng dữ liệu của người dùng khác. Toàn bộ phân tích chạy trên máy bạn và không gửi nội dung tin đi đâu.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Dán nội dung tin đăng",
    desc: "Cách xưng hô, lý do bán, và các cụm như ký gửi, chính chủ, miễn trung gian.",
  },
  {
    title: "Đọc dấu hiệu trong câu chữ",
    desc: "Phân tích chạy ngay trên máy bạn. Không gọi AI, không tra cứu số điện thoại, không lưu nội dung tin.",
  },
  {
    title: "Xem kết quả và câu hỏi cần hỏi",
    desc: "Kết quả nói về dấu hiệu trong tin, kèm danh sách câu hỏi để bạn tự xác minh khi gặp người bán.",
  },
];

export default function OwnerSignalPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <main className="min-h-screen bg-cream">
      <SiteHeader />
      <script
        type="application/ld+json"
        // Nội dung là hằng số, không phải input người dùng.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section className="mx-auto max-w-[760px] px-5 py-10 md:px-8 md:py-14">
        <div className="text-micro font-semibold uppercase tracking-[0.09em] text-gold-ink">
          CÔNG CỤ MIỄN PHÍ · KHÔNG CẦN ĐĂNG NHẬP
        </div>
        <h1 className="mt-3 font-display text-[26px] font-extrabold leading-[1.2] tracking-tight text-navy md:text-h1">
          Tin này là chính chủ hay môi giới?
        </h1>
        <p className="mt-3 text-[14px] leading-[1.6] text-ink-600">
          Dán nội dung tin đăng để CheckBDS phân tích các dấu hiệu trong cách viết và cho biết tin đang
          giống người bán trực tiếp, môi giới, hay chưa đủ dữ liệu.
        </p>

        {/* Giới hạn năng lực: đặt ngay trên công cụ, không chỉ ở footer. */}
        <p className="mt-4 rounded-[12px] border border-gold-base/60 bg-gold-base/10 px-4 py-3 text-[13px] font-semibold leading-relaxed text-ink-900">
          CheckBDS chỉ phân tích dấu hiệu trong nội dung tin đăng, không xác minh danh tính người bán.
        </p>

        <div className="mt-8">
          <OwnerSignalClient />
        </div>

        <section className="mt-10" aria-label="Cách hoạt động">
          <h2 className="text-[18px] font-black text-navy">Cách hoạt động</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {HOW_IT_WORKS.map((s, i) => (
              <div key={s.title} className="rounded-[14px] border border-line bg-white p-4">
                <div className="text-micro font-black tabular-nums text-gold-ink">BƯỚC {i + 1}</div>
                <div className="mt-1 text-[13px] font-bold text-navy">{s.title}</div>
                <p className="mt-1 text-micro leading-relaxed text-ink-600">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10" aria-label="Câu hỏi thường gặp">
          <h2 className="text-[18px] font-black text-navy">Câu hỏi thường gặp</h2>
          <div className="mt-4 space-y-3">
            {FAQS.map((f) => (
              <details key={f.q} className="rounded-[14px] border border-line bg-white p-4">
                <summary className="min-h-12 cursor-pointer list-none text-[13px] font-bold text-navy">
                  {f.q}
                </summary>
                <p className="mt-2 text-[12px] leading-relaxed text-ink-600">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </section>

      <SiteFooter />
    </main>
  );
}
