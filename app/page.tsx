import { SiteHeader } from "@/components/site/header";
import { Checker } from "@/components/site/checker";
import { MarketTable } from "@/components/site/market-table";
import { CtaPro } from "@/components/site/cta-pro";
import { SiteFooter } from "@/components/site/footer";

// Trang chủ: hero + ô check + bảng giá thị trường + CTA Pro + footer
export default function HomePage() {
  return (
    <main className="min-h-screen bg-cream text-slate-800 font-[Inter,sans-serif] selection:bg-gold/30">
      <SiteHeader />
      <Checker />
      <MarketTable />
      <CtaPro />
      <SiteFooter />
    </main>
  );
}
