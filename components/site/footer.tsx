// Footer nhỏ cuối trang
export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-[1120px] px-5 md:px-8 py-6 flex flex-col md:flex-row gap-3 items-start md:items-center justify-between text-[11px] text-slate-500">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold text-navy">BĐS Ngộp Thơm Checker</span>
          <span>•</span>
          <span>Powered by AI</span>
          <span className="hidden md:inline">•</span>
          <span className="px-2 py-1 rounded-full bg-slate-100 border">Vercel Edge • /api/check proxy</span>
        </div>
        <div className="text-slate-400 max-w-[520px] leading-snug">
          Chấm điểm qua <code>/api/check</code> với prompt scoring + market data Vũng Tàu. Không lưu dữ liệu người
          dùng.
        </div>
      </div>
    </footer>
  );
}
