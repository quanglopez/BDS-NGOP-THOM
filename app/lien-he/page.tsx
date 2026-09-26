import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { LeadForm } from "@/components/leads/lead-form";

export const metadata: Metadata = {
  title: "Liên hệ – CheckBDS.online",
  description: "Liên hệ hỗ trợ CheckBDS: nâng cấp, hoàn tiền, lỗi khi dùng.",
};

const TOPICS = [
  { title: "Hỗ trợ kỹ thuật", desc: "Lỗi khi check tin, không nhận được nâng cấp sau khi chuyển khoản." },
  { title: "Hoàn tiền", desc: "Yêu cầu hoàn tiền 100% trong 3 ngày đầu — xem chính sách hoàn tiền." },
  { title: "Hợp tác & góp ý", desc: "Góp ý tính năng, hợp tác với sàn/tổ đội môi giới." },
];

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-cream">
      <SiteHeader />

      <section className="mx-auto max-w-[1120px] px-5 md:px-8 py-12">
        <div className="max-w-[640px]">
          <h1 className="text-[28px] md:text-[36px] font-black tracking-tight text-navy">Liên hệ</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-slate-500">
            Để lại email (và SĐT nếu cần), chúng tôi phản hồi trong 24 giờ làm việc.
          </p>
        </div>

        <div className="mt-8 grid md:grid-cols-2 gap-6 items-start">
          <div className="space-y-3">
            {TOPICS.map((t) => (
              <div key={t.title} className="rounded-[16px] border border-slate-200 bg-white p-5">
                <div className="text-[14px] font-black text-navy">{t.title}</div>
                <p className="mt-1.5 text-[13px] text-slate-500 leading-relaxed">{t.desc}</p>
              </div>
            ))}
          </div>

          <div>
            <LeadForm planInterest="lien-he" />
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-slate-500">
              <Link href="/hoan-tien" className="font-semibold text-navy hover:underline">
                Chính sách hoàn tiền
              </Link>
              <Link href="/dieu-khoan" className="font-semibold text-navy hover:underline">
                Điều khoản sử dụng
              </Link>
              <Link href="/bao-mat" className="font-semibold text-navy hover:underline">
                Chính sách bảo mật
              </Link>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
