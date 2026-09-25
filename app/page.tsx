import { SiteHeader } from "@/components/site/header";
import { Checker } from "@/components/site/checker";
import { SocialProof } from "@/components/site/social-proof";
import { Coverage } from "@/components/site/coverage";
import { Comparison } from "@/components/site/comparison";
import { SalesHero } from "@/components/site/sales-hero";
import { Faq } from "@/components/site/faq";
import { CtaPro } from "@/components/site/cta-pro";
import { SiteFooter } from "@/components/site/footer";

// Trang chủ: hero + ô check + social proof + bảng giá thị trường + so sánh + bán hàng + FAQ + CTA
export default function HomePage() {
  return (
    <main className="min-h-screen bg-cream text-slate-800 font-[Inter,sans-serif] selection:bg-gold/30">
      <SiteHeader />
      <Checker />
      <SocialProof />
      <Coverage />
      <Comparison />
      <SalesHero />
      <Faq />
      <CtaPro />
      <SiteFooter />
    </main>
  );
}
