// Social proof: phản hồi thật từ người dùng thật.
//
// ADMIN: điền review thật vào mảng TESTIMONIALS bên dưới.
// TUYỆT ĐỐI không bịa tên, số liệu hay review. Mảng rỗng thì section tự ẩn
// hoàn toàn — để trống còn hơn render placeholder "Chờ đánh giá", vì placeholder
// làm lộ ra chỗ sản phẩm chưa có người dùng thật.

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

export function SocialProof() {
  // Chưa có review thật: không render gì. Section rỗng thành một khoảng trống
  // vô nghĩa giữa funnel, còn placeholder thì tệ hơn.
  if (TESTIMONIALS.length === 0) return null;

  return (
    <section className="mx-auto max-w-[1120px] px-5 py-12 md:px-8 md:py-16">
      <div className="mx-auto max-w-[640px] text-center">
        <div className="text-micro font-semibold uppercase tracking-[0.09em] text-gold-deep">
          Phản hồi
        </div>
        <h2 className="mt-3 font-display text-h2 text-ink-900">
          Môi giới đang dùng CheckBDS như thế nào?
        </h2>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        {TESTIMONIALS.map((r, i) => (
          <div
            key={i}
            className="rounded-lg border border-line bg-white p-5 transition-colors duration-micro ease-cb hover:border-navy-600/25 hover:shadow-lift"
          >
            <div className="flex items-center gap-3">
              {r.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.avatar}
                  alt=""
                  className="h-10 w-10 rounded-full bg-surface-mist object-cover"
                />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface-mist text-small font-bold text-ink-500">
                  {r.name.slice(0, 1)}
                </span>
              )}
              <div>
                <div className="text-small font-bold text-ink-900">{r.name}</div>
                <div className="text-micro text-ink-600">{r.area}</div>
              </div>
            </div>

            <p className="mt-4 text-small leading-relaxed text-ink-600">“{r.quote}”</p>

            {r.stat && (
              <div className="mt-3 rounded-sm border border-line bg-surface-mist px-3 py-2 text-micro text-ink-600">
                {r.stat}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
