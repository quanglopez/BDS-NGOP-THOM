import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { LegalQuizClient } from "@/components/legal-quiz/quiz-client";
import { QUESTIONS } from "@/lib/legal-quiz/questions";

const TITLE =
  "Kiểm tra pháp lý nhà đất trước khi đặt cọc — 12 câu hỏi, 2 phút, biết ngay rủi ro";

export const metadata: Metadata = {
  title: TITLE,
  description:
    "Trả lời 12 câu về sổ đỏ, quy hoạch, hoàn công, tranh chấp, thế chấp và đồng sở hữu để biết mức rủi ro pháp lý trước khi đặt cọc. Không cần đăng nhập.",
  alternates: { canonical: "/tools/kiem-tra-phap-ly-truoc-coc" },
  keywords: [
    "kiểm tra pháp lý nhà đất",
    "kiểm tra quy hoạch",
    "nhà chưa hoàn công",
    "vi bằng",
    "sổ chung",
    "checklist mua đất",
  ],
  robots: { index: true, follow: true },
};

// FAQ chỉ đưa vào structured data khi nội dung thật sự có trên trang.
const FAQS = [
  {
    q: "Vi bằng có mua bán được nhà đất không?",
    a: "Vi bằng chỉ ghi nhận sự kiện, không xác nhận quyền sở hữu. Giao dịch chỉ bằng vi bằng có rủi ro rất cao.",
  },
  {
    q: "Chưa hoàn công có mua được không?",
    a: "Có thể, nhưng công trình chưa hoàn công có thể bị xử phạt và khó sang tên. Nên yêu cầu hồ sơ hoàn công trước khi đặt cọc.",
  },
  {
    q: "Kiểm tra quy hoạch ở đâu?",
    a: "Tra tại UBND quận/huyện hoặc cổng thông tin quy hoạch của địa phương nơi có thửa đất.",
  },
  {
    q: "Kết quả của công cụ này có thay thế kiểm tra thực tế không?",
    a: "Không. Kết quả dựa trên thông tin bạn tự khai báo và không thay thế việc kiểm tra sổ và quy hoạch thực tế.",
  },
];

export default function LegalQuizPage() {
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
          {TITLE}
        </h1>
        <p className="mt-3 text-[14px] leading-[1.6] text-ink-600">
          Trả lời {QUESTIONS.length} câu về giấy tờ, quy hoạch và tình trạng tài sản. CheckBDS chấm
          mức rủi ro và chỉ ra việc cần xác minh trước khi bạn đặt cọc.
        </p>

        <div className="mt-8">
          <LegalQuizClient />
        </div>

        <section className="mt-10" aria-label="Câu hỏi thường gặp">
          <h2 className="text-[18px] font-black text-navy">Câu hỏi thường gặp</h2>
          <div className="mt-4 space-y-3">
            {FAQS.map((f) => (
              <details
                key={f.q}
                className="rounded-[14px] border border-line bg-white p-4"
              >
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
