// Social proof: case study môi giới dùng CheckBDS.
// ADMIN: điền review thật vào mảng TESTIMONIALS bên dưới (để trống = hiện placeholder).
// TUYỆT ĐỐI không bịa tên/số liệu — section này tự ẩn phần số khi chưa có dữ liệu thật.

interface Testimonial {
  name: string;
  area: string;
  avatar?: string;
  quote: string;
  stat: string;
}

const TESTIMONIALS: Testimonial[] = [
  // Ví dụ định dạng để admin điền theo:
  // { name: "Anh Tuấn", area: "Gò Vấp, TP.HCM", quote: "...", stat: "Quét 230 tin → lọc còn 17 tin >80 điểm → chọn 6 tin gọi trước." }
];

const PLACEHOLDER: Testimonial[] = [
  { name: "Chờ đánh giá", area: "—", quote: "Chưa có đánh giá nào được ghi nhận.", stat: "" },
  { name: "Chờ đánh giá", area: "—", quote: "Chưa có đánh giá nào được ghi nhận.", stat: "" },
  { name: "Chờ đánh giá", area: "—", quote: "Chưa có đánh giá nào được ghi nhận.", stat: "" },
];

export function SocialProof() {
  const real = TESTIMONIALS.length > 0;
  const rows = real ? TESTIMONIALS : PLACEHOLDER;

  return (
    <section className="mx-auto max-w-[1120px] px-5 md:px-8 py-12 md:py-16">
      <div className="text-center max-w-[640px] mx-auto">
        <div className="text-[11px] font-black tracking-[0.2em] uppercase text-[#a5823f]">Phản hồi</div>
        <h2 className="mt-3 text-[24px] md:text-[32px] font-black tracking-tight text-navy">
          Môi giới đang dùng CheckBDS như thế nào?
        </h2>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        {rows.map((r, i) => (
          <div
            key={i}
            className={`rounded-[18px] p-5 ${
              real
                ? "border border-slate-200 bg-white hover:border-navy/25 transition"
                : "border border-dashed border-slate-300 bg-white/60"
            }`}
          >
            <div className="flex items-center gap-3">
              {r.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.avatar} alt="" className="w-10 h-10 rounded-full object-cover bg-slate-100" />
              ) : (
                <span className="w-10 h-10 rounded-full bg-cream border border-slate-200 flex items-center justify-center text-[13px] font-black text-slate-400">
                  {r.name.slice(0, 1)}
                </span>
              )}
              <div>
                <div className={`text-[13px] font-black ${real ? "text-navy" : "text-slate-400"}`}>{r.name}</div>
                <div className="text-[11px] text-slate-500">{r.area}</div>
              </div>
            </div>

            <p className={`mt-4 text-[13px] leading-relaxed ${real ? "text-slate-600" : "text-slate-400 italic"}`}>
              “{r.quote}”
            </p>

            {r.stat && (
              <div className="mt-3 rounded-[10px] bg-cream border border-slate-200 px-3 py-2 text-[11px] text-slate-600">
                {r.stat}
              </div>
            )}
          </div>
        ))}
      </div>

      {!real && (
        <p className="mt-5 text-center text-[12px] text-slate-400">
          Chúng tôi chỉ đăng phản hồi thật từ người dùng thật.
        </p>
      )}
    </section>
  );
}
