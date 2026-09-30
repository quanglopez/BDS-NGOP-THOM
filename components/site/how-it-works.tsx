import { ClipboardList, Cpu, PhoneCall, type LucideIcon } from "lucide-react";

// "Cách hoạt động" — 3 bước, hiểu trong 5 giây
// `icon` là tên icon trong hệ lucide, không phải emoji nhúng chuỗi.
const ICONS: Record<string, LucideIcon> = {
  clipboard: ClipboardList,
  cpu: Cpu,
  phone: PhoneCall,
};

const STEPS = [
  {
    icon: "clipboard",
    title: "Dán link hoặc nội dung tin BĐS",
    desc: "Link tin, link danh mục Nhà Tốt/Chợ Tốt, hoặc copy mô tả tin đều được.",
  },
  {
    icon: "cpu",
    title: "CheckBDS phân tích và chấm điểm",
    desc: "Giá, vị trí, pháp lý, thanh khoản và dấu hiệu bán gấp — theo 6 tiêu chí.",
  },
  {
    icon: "phone",
    title: "Ưu tiên những tin đáng gọi nhất",
    desc: "Kèo ngon nổi lên đầu kèm lý do. Bạn chỉ việc gọi chủ nhà.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-[1120px] px-5 py-12 md:px-8 md:py-16">
      <div className="mx-auto max-w-[640px] text-center">
        <div className="text-micro font-semibold uppercase tracking-[0.09em] text-gold-deep">
          Cách hoạt động
        </div>
        <h2 className="mt-3 font-display text-h2 text-ink-900">3 bước, 1 phút</h2>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => {
          const Icon = ICONS[s.icon];
          return (
            <div key={s.title} className="relative rounded-lg border border-line bg-white p-6">
              <div className="absolute right-5 top-5 select-none font-display text-[34px] leading-none font-extrabold text-line">
                {i + 1}
              </div>
              <span className="flex h-12 w-12 items-center justify-center rounded-md bg-navy-900 text-white">
                {Icon ? <Icon size={22} strokeWidth={1.75} aria-hidden="true" /> : null}
              </span>
              <div className="mt-4 text-small font-bold leading-tight text-ink-900">{s.title}</div>
              <p className="mt-2 text-micro leading-relaxed text-ink-600">{s.desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
