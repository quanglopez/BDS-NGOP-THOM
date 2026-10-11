import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { DealGraderClient } from "@/components/deal-grader/deal-grader-client";

const TITLE = "Chấm điểm tin đăng BĐS trước khi gọi | CheckBDS";

export const metadata: Metadata = {
  title: TITLE,
  description:
    "Dán nội dung tin đăng để xem nhanh mức đáng gọi, dấu hiệu bán gấp, rủi ro pháp lý và các điểm cần kiểm tra thêm. Chấm nhanh miễn phí, không cần đăng nhập.",
  alternates: { canonical: "/tools/cham-diem-tin-dang" },
  keywords: [
    "chấm điểm tin đăng bất động sản",
    "tin bất động sản đáng gọi",
    "bán gấp",
    "rủi ro pháp lý",
    "phân tích tin đăng",
    "kiểm tra tin bất động sản",
  ],
  robots: { index: true, follow: true },
};

// FAQ chỉ vào structured data khi nội dung thật sự hiển thị trên trang.
const FAQS = [
  {
    q: "Điểm này có phải do AI chấm không?",
    a: "Không. Điểm nhanh do mô hình chấm điểm theo công thức của CheckBDS chạy trực tiếp trên máy bạn, không gọi AI. Muốn chấm bằng AI thì cần đăng nhập và dùng một lượt trong quota tài khoản.",
  },
  {
    q: "Vì sao cần đăng nhập để chấm bằng AI?",
    a: "Lượt chấm AI tốn chi phí gọi model nên CheckBDS gắn với tài khoản để kiểm soát hạn mức và lưu lại báo cáo cho bạn mở lại sau. Bản chấm nhanh thì không cần đăng nhập và không tốn lượt nào.",
  },
  {
    q: "CheckBDS có xác minh tin là chính chủ không?",
    a: "Không. Phiên bản này không phân loại người đăng là chủ nhà hay môi giới, và cũng không xác minh danh tính người bán. Bạn cần tự đối chiếu giấy tờ tùy thân với tên trên sổ khi gặp trực tiếp.",
  },
  {
    q: "Điểm giá có phải là định giá thị trường không?",
    a: "Không. Tín hiệu giá chỉ đọc từ nội dung tin đăng (giá và diện tích người đăng ghi). Đây không phải định giá thị trường và không đối chiếu với dữ liệu giao dịch thực tế.",
  },
  {
    q: "Kết quả có thay thế kiểm tra pháp lý không?",
    a: "Không. Kết quả chỉ là bước sàng lọc tín hiệu từ nội dung tin. Bạn vẫn phải tự xem sổ gốc, tra quy hoạch và kiểm tra thế chấp trước khi đặt cọc.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Dán nội dung tin đăng",
    desc: "Giá, diện tích, giấy tờ, khu vực, lý do bán — càng đủ chi tiết thì tín hiệu càng sát.",
  },
  {
    title: "Chấm nhanh miễn phí",
    desc: "Điểm 0–100, mức đáng gọi, dấu hiệu bán gấp và các điểm cần kiểm tra. Không cần đăng nhập.",
  },
  {
    title: "Chấm sâu bằng AI nếu cần",
    desc: "Đăng nhập rồi chấm bằng AI để lưu báo cáo, dùng đúng quota tài khoản hiện có.",
  },
];

export default function DealGraderPage() {
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
          Chấm điểm tin đăng BĐS trước khi gọi
        </h1>
        <p className="mt-3 text-[14px] leading-[1.6] text-ink-600">
          Dán nội dung tin đăng để xem nhanh mức đáng gọi, dấu hiệu bán gấp, rủi ro pháp lý và các điểm
          cần kiểm tra thêm.
        </p>

        <div className="mt-8">
          <DealGraderClient />
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
