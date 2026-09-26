// "Cách hoạt động" — 3 bước, hiểu trong 5 giây
const STEPS = [
  {
    icon: "📋",
    title: "Dán link hoặc nội dung tin BĐS",
    desc: "Link tin, link danh mục Nhà Tốt/Chợ Tốt, hoặc copy mô tả tin đều được.",
  },
  {
    icon: "🤖",
    title: "CheckBDS phân tích và chấm điểm",
    desc: "Giá, vị trí, pháp lý, thanh khoản và dấu hiệu bán gấp — theo 6 tiêu chí.",
  },
  {
    icon: "📞",
    title: "Ưu tiên những tin đáng gọi nhất",
    desc: "Kèo ngon nổi lên đầu kèm lý do. Bạn chỉ việc gọi chủ nhà.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-[1120px] px-5 md:px-8 py-12 md:py-16">
      <div className="text-center max-w-[640px] mx-auto">
        <div className="text-[11px] font-black tracking-[0.2em] uppercase text-[#a5823f]">Cách hoạt động</div>
        <h2 className="mt-3 text-[24px] md:text-[32px] font-black tracking-tight text-navy">3 bước, 1 phút</h2>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        {STEPS.map((s, i) => (
          <div key={s.title} className="relative rounded-[18px] border border-slate-200 bg-white p-6">
            <div className="absolute top-5 right-5 text-[34px] font-black text-slate-100 leading-none select-none">
              {i + 1}
            </div>
            <span className="w-12 h-12 rounded-[14px] bg-navy flex items-center justify-center text-[22px]">
              {s.icon}
            </span>
            <div className="mt-4 text-[15px] font-black text-navy leading-tight">{s.title}</div>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-500">{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
