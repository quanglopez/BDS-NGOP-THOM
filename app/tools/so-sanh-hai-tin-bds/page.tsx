import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { DuplicateCheckClient } from "@/components/duplicate-check/duplicate-check-client";
import { LIMITATION } from "@/lib/duplicate-check/wording";

const TITLE = "So sánh 2 tin BĐS có dấu hiệu giống nhau | CheckBDS";
const H1 = "So sánh 2 tin BĐS có dấu hiệu giống nhau";

export const metadata: Metadata = {
  title: TITLE,
  description:
    "Dán 2 tin BĐS để xem điểm giống và khác (dự án, vị trí, diện tích, phòng ngủ, giá niêm yết) kèm câu hỏi đối chiếu. Chỉ so sánh câu chữ bạn dán, không xác nhận cùng tài sản.",
  alternates: { canonical: "/tools/so-sanh-hai-tin-bds" },
  keywords: [
    "so sánh 2 tin bds",
    "so sánh hai tin đăng",
    "tin đăng giống nhau",
    "chênh lệch giá niêm yết",
    "đối chiếu hai tin bất động sản",
  ],
  robots: { index: true, follow: true },
};

/**
 * MỘT nguồn FAQ duy nhất: mảng này vừa render phần hiển thị vừa dựng FAQPage
 * JSON-LD, nên structured data không bao giờ lệch với nội dung người dùng đọc.
 *
 * KHÔNG export: Next.js chỉ cho phép export một số tên cố định trong file page.
 */
const FAQS = [
  {
    q: "CheckBDS có xác nhận hai tin là cùng một tài sản không?",
    a: "Không. Công cụ chỉ so sánh câu chữ bạn dán và chỉ ra điểm giống, điểm khác. Cùng dự án và cùng diện tích vẫn có thể là hai căn khác nhau. Việc đó phải được đối chiếu trực tiếp qua giấy tờ và hiện trạng tài sản.",
  },
  {
    q: "Hai tin ghi giá khác nhau có nghĩa là tin nào sai không?",
    a: "Không. Giá trong tin là giá niêm yết theo cách người đăng ghi. Hai tin giống nhau vẫn có thể ghi giá khác nhau, và ngược lại. CheckBDS không xác định giá thật của bất động sản.",
  },
  {
    q: "Cùng dự án và cùng diện tích có đủ để coi là cùng căn không?",
    a: "Không. Một dự án có rất nhiều căn cùng diện tích. Cần đối chiếu thêm block hoặc tòa, tầng, và mã căn trước khi kết luận.",
  },
  {
    q: "Nội dung hai tin có được lưu không?",
    a: "Không. Toàn bộ so sánh chạy trong trình duyệt của bạn. Nội dung hai tin không được gửi lên máy chủ, không lưu vào cơ sở dữ liệu, và không tốn lượt nào.",
  },
  {
    q: "Công cụ có dùng số điện thoại để xác định cùng người bán không?",
    a: "Không. Số điện thoại bị loại khỏi phần so sánh và không bao giờ được dùng làm bằng chứng hay để nhận diện người đăng.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Dán 2 tin cần so sánh",
    desc: "Mỗi tin: dự án, vị trí, diện tích, phòng ngủ, giá ghi trong tin.",
  },
  {
    title: "Đọc điểm giống và khác",
    desc: "Phân tích chạy ngay trên máy bạn. Không gọi AI, không lưu nội dung, không tốn lượt nào.",
  },
  {
    title: "Đối chiếu theo câu hỏi",
    desc: "Dùng danh sách câu hỏi để tự kiểm tra trước khi coi hai tin là liên quan.",
  },
];

export default function DuplicateComparePage() {
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

      <section className="mx-auto max-w-[860px] px-5 py-10 md:px-8 md:py-14">
        <div className="text-micro font-semibold uppercase tracking-[0.09em] text-gold-ink">
          CÔNG CỤ MIỄN PHÍ · KHÔNG CẦN ĐĂNG NHẬP
        </div>
        <h1 className="mt-3 font-display text-[26px] font-extrabold leading-[1.2] tracking-tight text-navy md:text-h1">
          {H1}
        </h1>
        <p className="mt-3 text-[14px] leading-[1.6] text-ink-600">
          Dán nội dung 2 tin đăng để xem điểm giống, điểm khác và danh sách câu hỏi nên đối chiếu
          trước khi coi hai tin là liên quan đến nhau.
        </p>

        {/* Giới hạn năng lực: đặt ngay trên công cụ, không chỉ ở footer. */}
        <p className="mt-4 rounded-[12px] border border-gold-base/60 bg-gold-base/10 px-4 py-3 text-[13px] font-semibold leading-relaxed text-ink-900">
          {LIMITATION}
        </p>

        <div className="mt-8">
          <DuplicateCheckClient />
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
