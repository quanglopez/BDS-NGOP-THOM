import Link from "next/link";

const NAV = [
  { href: "#tinh-nang", label: "Tính năng" },
  { href: "#so-sanh", label: "So sánh" },
  { href: "/pricing", label: "Bảng giá" },
  { href: "#faq", label: "FAQ" },
];

// Header dính trên cùng: logo + nav + nút đăng nhập/dashboard
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-navy/90 border-b border-white/10">
      <div className="mx-auto max-w-[1120px] px-5 md:px-8 h-[64px] flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gold flex items-center justify-center text-navy font-black text-[14px] tracking-widest shadow-[0_4px_16px_-4px_rgba(201,168,106,0.6)]">
            AI
          </div>
          <div className="leading-none">
            <div className="font-extrabold text-[15px] tracking-tight text-white">BĐS NGỘP THƠM</div>
            <div className="text-[10px] tracking-[0.18em] font-semibold text-gold mt-[3px]">
              TOÀN QUỐC • AI SCORING
            </div>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-[13px] font-semibold text-slate-300">
          {NAV.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className="px-3 py-2 rounded-lg hover:text-white hover:bg-white/10 transition"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <span className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-[11px] font-semibold text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            AI đang hoạt động
          </span>
          <Link
            href="/login"
            className="h-10 px-5 rounded-[10px] bg-gold text-navy text-[13px] font-bold flex items-center hover:bg-[#d8ba7f] transition shadow-[0_4px_16px_-4px_rgba(201,168,106,0.5)]"
          >
            Đăng nhập
          </Link>
        </div>
      </div>
    </header>
  );
}
