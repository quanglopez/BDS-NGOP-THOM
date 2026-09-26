import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/header";
import { Hero } from "@/components/site/hero";
import { Checker } from "@/components/site/checker";
import { ProductDemo } from "@/components/site/product-demo";
import { Benefits } from "@/components/site/benefits";
import { HowItWorks } from "@/components/site/how-it-works";
import { ExampleAnalysis } from "@/components/site/example-analysis";
import { BulkSection } from "@/components/site/bulk-section";
import { SocialProof } from "@/components/site/social-proof";
import { FreeVsPro } from "@/components/site/free-vs-pro";
import { Faq } from "@/components/site/faq";
import { FinalCta } from "@/components/site/final-cta";
import { StickyCta } from "@/components/site/sticky-cta";
import { SiteFooter } from "@/components/site/footer";
import { HomePageTracker } from "@/components/site/home-tracker";

export const metadata: Metadata = {
  title: "CheckBDS.online – Lọc 100 tin BĐS trong 1 phút",
  description:
    "Biết tin nào đáng gọi chủ nhà trước. CheckBDS phân tích giá, vị trí, pháp lý, thanh khoản và dấu hiệu bán gấp từ link Nhà Tốt/Chợ Tốt hoặc nội dung tin rao. Miễn phí 20 tin/ngày.",
};

// Landing theo thứ tự phễu: Hero -> Demo -> Lợi ích -> 3 bước -> Ví dụ -> Bulk
// -> Social proof -> Free/Pro -> FAQ -> CTA cuối
export default function HomePage() {
  return (
    <main className="min-h-screen bg-cream text-slate-800 selection:bg-gold/30">
      <HomePageTracker />
      <SiteHeader />
      <Hero />
      <Checker />
      <ProductDemo />
      <section id="tinh-nang" className="scroll-mt-20">
        <Benefits />
      </section>
      <section id="cach-hoat-dong" className="scroll-mt-20">
        <HowItWorks />
      </section>
      <ExampleAnalysis />
      <BulkSection />
      <SocialProof />
      <FreeVsPro />
      <Faq />
      <FinalCta />
      <SiteFooter />
      <StickyCta />
    </main>
  );
}
