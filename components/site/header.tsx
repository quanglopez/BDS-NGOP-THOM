import Link from "next/link";

// Header dính trên cùng: logo navy + badge trạng thái live market
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 border-b border-slate-200/60">
      <div className="mx-auto max-w-[1120px] px-5 md:px-8 h-[64px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-navy flex items-center justify-center text-gold font-black text-[14px] tracking-widest">
            AI
          </div>
          <div className="leading-none">
            <div className="font-extrabold text-[15px] tracking-tight text-navy">BĐS NGỘP THƠM</div>
            <div className="text-[11px] tracking-[0.14em] font-semibold text-slate-500 mt-[2px]">
              VŨNG TÀU • AI
            </div>
          </div>
        </Link>

        <div className="hidden md:flex items-center gap-2 text-[12px] font-medium">
          <span className="px-3 py-1.5 rounded-full bg-navy text-white">● Mức giá cập nhật định kỳ</span>
          <span className="px-3 py-1.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
            Powered by AI
          </span>
        </div>

        <div className="md:hidden text-[10px] font-bold tracking-widest text-slate-500">AI</div>
      </div>
    </header>
  );
}
