// Dải niềm tin: chỉ nói đúng những gì đang có thật (beta + năng lực tool)
const STATS = [
  { v: "1 phút", l: "lọc 100 tin Bulk Check" },
  { v: "6 tiêu chí", l: "AI chấm mỗi tin" },
  { v: "63 tỉnh", l: "tự nhận diện khu vực" },
  { v: "20 tin", l: "miễn phí mỗi ngày" },
];

export function SocialProof() {
  return (
    <section className="mx-auto max-w-[1120px] px-5 md:px-8 pt-10">
      <div className="rounded-[20px] border border-slate-200 bg-white p-5 md:p-7 shadow-[0_10px_40px_-20px_rgba(11,29,58,0.25)]">
        <div className="flex flex-col md:flex-row md:items-center gap-5">
          <div className="flex items-center gap-3 shrink-0">
            <span className="w-10 h-10 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center text-[16px]">
              🚀
            </span>
            <div>
              <div className="text-[15px] font-black text-navy">Đang mở beta cho môi giới</div>
              <div className="mt-0.5 text-[12px] text-slate-500">
                Giới thiệu bạn dùng link của mình → <b className="text-navy">+10 check free</b>
              </div>
            </div>
          </div>

          <div className="md:ml-auto grid grid-cols-2 sm:grid-cols-4 gap-4 md:gap-6 md:text-right w-full md:w-auto">
            {STATS.map((s) => (
              <div key={s.l}>
                <div className="text-[18px] font-black text-navy tabular-nums">{s.v}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
