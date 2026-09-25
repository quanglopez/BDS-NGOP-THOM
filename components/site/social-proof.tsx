// Dải social proof: số môi giới đang dùng
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
              +115
            </div>
          </div>

          <div>
            <div className="text-[15px] font-black text-navy">120+ môi giới Vũng Tàu đang dùng</div>
            <div className="mt-1 text-[12px] text-slate-500">
              ⭐ 4.8/5 từ 47 đánh giá • Trung bình lọc 100 tin trong 1 phút
            </div>
          </div>

          <div className="ml-auto grid grid-cols-3 gap-4 text-center">
            {[
              { v: "18.500+", l: "tin đã check" },
              { v: "2.100+", l: "kèo ngộp phát hiện" },
              { v: "~2 phút", l: "tiết kiệm/tin" },
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
