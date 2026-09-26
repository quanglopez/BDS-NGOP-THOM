// "CheckBDS giúp môi giới làm gì?" — lợi ích thực tế, không nói về AI
const BENEFITS = [
  {
    icon: "⏱",
    title: "Bỏ 3–4 giờ đọc tin mỗi ngày",
    desc: "Quét 100 tin trong 1 phút thay vì ngồi lướt từng tin trên Chợ Tốt, Nhà Tốt, Zalo.",
  },
  {
    icon: "📞",
    title: "Biết tin nào đáng gọi trước",
    desc: "Kèo ngộp, bán gấp, giá dưới mặt bằng nổi lên trên cùng — gọi đúng người, đúng lúc.",
  },
  {
    icon: "🧭",
    title: "Không bỏ sót kèo ngon",
    desc: "Hàng trăm tin mới mỗi ngày, nhưng chỉ vài tin thật sự thơm. CheckBDS lọc giúp bạn.",
  },
  {
    icon: "🛡️",
    title: "Tránh rủi ro pháp lý",
    desc: "Nhận diện giấy tay, vi bằng, sổ chung, tranh chấp, quy hoạch treo trước khi tốn thời gian xem nhà.",
  },
  {
    icon: "📊",
    title: "Mặc cả có căn cứ",
    desc: "So sánh giá rao với mặt bằng khu vực để biết nên trả bao nhiêu và ép được bao nhiêu.",
  },
  {
    icon: "🗂",
    title: "Lịch sử trong tầm tay",
    desc: "Mọi tin đã check lưu lại kèm link gốc — quay lại gọi chủ nhà bất cứ lúc nào.",
  },
];

export function Benefits() {
  return (
    <section className="mx-auto max-w-[1120px] px-5 md:px-8 py-12 md:py-16">
      <div className="text-center max-w-[640px] mx-auto">
        <div className="text-[11px] font-black tracking-[0.2em] uppercase text-[#a5823f]">Lợi ích</div>
        <h2 className="mt-3 text-[24px] md:text-[32px] font-black tracking-tight text-navy">
          CheckBDS giúp môi giới làm gì?
        </h2>
      </div>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {BENEFITS.map((b) => (
          <div
            key={b.title}
            className="rounded-[18px] border border-slate-200 bg-white p-5 hover:border-navy/25 hover:shadow-[0_16px_40px_-24px_rgba(11,29,58,0.35)] transition"
          >
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 shrink-0 rounded-[12px] bg-cream border border-slate-200 flex items-center justify-center text-[18px]">
                {b.icon}
              </span>
              <div className="text-[14px] font-black text-navy leading-tight">{b.title}</div>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-500">{b.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
