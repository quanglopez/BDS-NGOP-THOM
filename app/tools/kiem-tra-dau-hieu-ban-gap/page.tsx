import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { UrgencyCheckClient } from "@/components/urgency-check/urgency-check-client";
import { LIMITATION } from "@/lib/urgency-check/wording";

const TITLE = "Kiểm tra dấu hiệu bán gấp trong tin BĐS | CheckBDS";
const H1 = "Kiểm tra dấu hiệu bán gấp trong tin BĐS";

export const metadata: Metadata = {
  title: TITLE,
  description:
    "Dán nội dung tin đăng để xem các cụm từ thể hiện bán gấp (kẹt tiền, cắt lỗ, ngộp ngân hàng…) và danh sách câu hỏi để tự xác minh lý do bán. CheckBDS chỉ phân tích câu chữ trong tin, không xác minh lý do bán.",
  alternates: { canonical: "/tools/kiem-tra-dau-hieu-ban-gap" },
  keywords: [
    "kiểm tra dấu hiệu bán gấp",
    "tin bán gấp",
    "dấu hiệu ngộp ngân hàng",
    "cắt lỗ bất động sản",
    "câu hỏi xác minh lý do bán",
  ],
  robots: { index: true, follow: true },
};

/**
 * MỘT nguồn FAQ duy nhất: mảng này vừa render phần hiển thị vừa dựng FAQPage
 * JSON-LD, nên structured data không bao giờ lệch với nội dung người dùng đọc.
 *
 * KHÔNG export: Next.js chỉ cho phép export một số tên cố định trong file page
 * (default, metadata, config, generateStaticParams…). Export thêm `FAQS` làm
 * build fail ở bước type-check của route.
 */
const FAQS = [
  {
    q: "CheckBDS có xác minh lý do bán không?",
    a: "Không. Công cụ chỉ đọc các cụm từ trong nội dung tin đăng và cho biết tin có dùng ngôn ngữ bán gấp hay không. Nó không liên hệ người bán, không kiểm tra tình trạng tài chính, và không xác minh lý do bán.",
  },
  {
    q: "\"Bán gấp\" có nghĩa là deal tốt không?",
    a: "Không. Bán gấp chỉ là cách viết trong tin, không nói gì về chất lượng hay mức giá. Một tin bán gấp có thể vẫn cao hơn mặt bằng, và một tin không bán gấp có thể lại là giá tốt. Đây là lý do công cụ này chỉ đưa ra câu hỏi để bạn tự kiểm tra.",
  },
  {
    q: "Nên hỏi gì khi thấy tin dùng từ \"bán gấp\"?",
    a: "Nên hỏi lý do cụ thể cần bán nhanh, giá hiện tại có phải giá chốt không, tin đã đăng bao lâu và giảm giá mấy lần, thời hạn cần hoàn tất giao dịch, và nếu không bán được trong thời hạn đó thì điều gì xảy ra. Kết quả kiểm tra có sẵn danh sách câu hỏi để bạn dùng khi gọi.",
  },
  {
    q: "Nội dung tin có được lưu không?",
    a: "Không. Với công cụ này, toàn bộ phân tích chạy trong trình duyệt của bạn. Nội dung tin không được gửi lên máy chủ, không được lưu vào cơ sở dữ liệu, và không tốn lượt chấm nào.",
  },
  {
    q: "Công cụ này có thay thế kiểm tra pháp lý không?",
    a: "Không. Đây chỉ là bước đọc câu chữ để bạn biết nên hỏi gì. Trước khi đặt cọc, bạn vẫn cần kiểm tra sổ, quy hoạch và tình trạng thế chấp. CheckBDS có công cụ riêng cho bước đó.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Dán nội dung tin đăng",
    desc: "Lý do bán, các cụm như bán gấp, cắt lỗ, ngộp, giảm giá, thời hạn bán.",
  },
  {
    title: "Đọc cụm từ trong tin",
    desc: "Phân tích chạy ngay trên máy bạn. Không gọi AI, không lưu nội dung tin, không tốn lượt nào.",
  },
  {
    title: "Hỏi theo checklist",
    desc: "Kết quả kèm danh sách câu hỏi để bạn tự xác minh lý do bán khi gọi.",
  },
];

export default function UrgencyCheckPage() {
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
          {H1}
        </h1>
        <p className="mt-3 text-[14px] leading-[1.6] text-ink-600">
          Dán nội dung tin đăng để xem các cụm từ thể hiện bán gấp và danh sách câu hỏi để bạn tự xác
          minh lý do bán khi gọi.
        </p>

        {/* Giới hạn năng lực: đặt ngay trên công cụ, không chỉ ở footer. */}
        <p className="mt-4 rounded-[12px] border border-gold-base/60 bg-gold-base/10 px-4 py-3 text-[13px] font-semibold leading-relaxed text-ink-900">
          {LIMITATION}
        </p>

        <div className="mt-8">
          <UrgencyCheckClient />
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
