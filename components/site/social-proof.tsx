// Dải social proof - chỉ nói đúng những gì đang có thật
export function SocialProof() {
  return (
    <section className="mx-auto max-w-[1120px] px-5 md:px-8 pt-10">
      <div className="rounded-[18px] border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex -space-x-2">
            {["MT", "TH", "HP", "NL", "VK"].map((a) => (
              <div
                key={a}
                className="w-9 h-9 rounded-full bg-navy text-gold border-2 border-white flex items-center justify-center text-[11px] font-bold"
              >
                {a}
              </div>
            ))}
            <div className="w-9 h-9 rounded-full bg-gold text-navy border-2 border-white flex items-center justify-center text-[10px] font-bold">
              +?
            </div>
          </div>

          <div>
            <div className="text-[15px] font-black text-navy">Đang mở beta cho môi giới Vũng Tàu</div>
            <div className="mt-1 text-[12px] text-slate-500">
              Mới ra mắt — mỗi môi giới giới thiệu được <b>+10 check free</b> khi bạn dùng link của họ.
            </div>
          </div>

          <div className="ml-auto grid grid-cols-3 gap-4 text-center">
            {[
              { v: "1 phút", l: "lọc 100 tin" },
              { v: "6 tiêu chí", l: "AI chấm mỗi tin" },
              { v: "Free 20", l: "tin/ngày" },
            ].map((s) => (
              <div key={s.l}>
                <div className="text-[16px] font-black text-navy">{s.v}</div>
                <div className="text-[11px] text-slate-500">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
