import {
  Clock,
  Compass,
  FolderOpen,
  PhoneCall,
  Scale,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

// "CheckBDS giúp môi giới làm gì?" — lợi ích thực tế, không nói về AI
// `icon` là tên icon trong hệ lucide, không phải emoji nhúng chuỗi.
const ICONS: Record<string, LucideIcon> = {
  clock: Clock,
  phone: PhoneCall,
  compass: Compass,
  shield: ShieldCheck,
  scale: Scale,
  folder: FolderOpen,
};

const BENEFITS = [
  {
    icon: "clock",
    title: "Bỏ 3–4 giờ đọc tin mỗi ngày",
    desc: "Quét 100 tin trong 1 phút thay vì ngồi lướt từng tin trên Chợ Tốt, Nhà Tốt, Zalo.",
  },
  {
    icon: "phone",
    title: "Biết tin nào đáng gọi trước",
    desc: "Kèo ngộp, bán gấp, giá dưới mặt bằng nổi lên trên cùng — gọi đúng người, đúng lúc.",
  },
  {
    icon: "compass",
    title: "Không bỏ sót kèo ngon",
    desc: "Hàng trăm tin mới mỗi ngày, nhưng chỉ vài tin thật sự thơm. CheckBDS lọc giúp bạn.",
  },
  {
    icon: "shield",
    title: "Tránh rủi ro pháp lý",
    desc: "Nhận diện giấy tay, vi bằng, sổ chung, tranh chấp, quy hoạch treo trước khi tốn thời gian xem nhà.",
  },
  {
    icon: "scale",
    title: "Mặc cả có căn cứ",
    desc: "So sánh giá rao với mặt bằng khu vực để biết nên trả bao nhiêu và ép được bao nhiêu.",
  },
  {
    icon: "folder",
    title: "Lịch sử trong tầm tay",
    desc: "Mọi tin đã check lưu lại kèm link gốc — quay lại gọi chủ nhà bất cứ lúc nào.",
  },
];

export function Benefits() {
  return (
    <section className="mx-auto max-w-[1120px] px-5 py-12 md:px-8 md:py-16">
      <div className="mx-auto max-w-[640px] text-center">
        <div className="text-micro font-semibold uppercase tracking-[0.09em] text-gold-ink">
          Lợi ích
        </div>
        <h2 className="mt-3 font-display text-h2 text-ink-900">
          CheckBDS giúp môi giới làm gì?
        </h2>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BENEFITS.map((b) => {
          const Icon = ICONS[b.icon];
          return (
            <div
              key={b.title}
              className="rounded-lg border border-line bg-white p-5 transition-colors duration-micro ease-cb hover:border-navy-600/25 hover:shadow-lift"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface-mist text-navy-600">
                  {Icon ? <Icon size={18} strokeWidth={1.75} aria-hidden="true" /> : null}
                </span>
                <div className="text-small font-bold leading-tight text-ink-900">{b.title}</div>
              </div>
              <p className="mt-3 text-micro leading-relaxed text-ink-600">{b.desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
