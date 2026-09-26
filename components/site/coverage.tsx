// Section giới thiệu phạm vi hỗ trợ toàn quốc + 6 tiêu chí AI chấm
const CRITERIA = [
  { icon: "💰", name: "Ngộp bank", desc: "Bán gấp, thanh lý, cần tiền gấp" },
  { icon: "📈", name: "Tiềm năng tăng giá", desc: "Vị trí, hạ tầng, nhu cầu khu vực" },
  { icon: "💧", name: "Thanh khoản", desc: "Mặt tiền / hẻm, dễ bán lại" },
  { icon: "📄", name: "Pháp lý", desc: "Sổ hồng, hoàn công, tranh chấp" },
  { icon: "💵", name: "Giá thị trường", desc: "So sánh mức giá rao" },
  { icon: "📍", name: "Vị trí", desc: "Khu vực, đường phố, tiện ích" },
];

const REGIONS = [
  { name: "Miền Bắc", cities: "Hà Nội, Hải Phòng, Quảng Ninh, Ninh Bình, Thanh Hóa…" },
  { name: "Miền Trung", cities: "Đà Nẵng, Huế, Quy Nhơn, Nha Trang, Buôn Ma Thuột…" },
  { name: "Miền Nam", cities: "TP.HCM, Bình Dương, Đồng Nai, Cần Thơ, Phú Quốc…" },
];

function Eyebrow({ children }: { children: string }) {
  return (
    <div className="text-[11px] font-black tracking-[0.2em] uppercase">
      <span className="text-[#a5823f]">{children}</span>
    </div>
  );
}

export function Coverage() {
  return (
    <section id="tinh-nang" className="mx-auto max-w-[1120px] px-5 md:px-8 py-12 md:py-16 scroll-mt-20">
      <div className="text-center max-w-[640px] mx-auto">
        <Eyebrow>Phạm vi hỗ trợ</Eyebrow>
        <h2 className="mt-3 text-[24px] md:text-[32px] font-black tracking-tight text-navy">
          Một tool, chấm tin cả nước
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-slate-500">
          Dán tin có tên tỉnh, quận/huyện hoặc đường phố — AI tự nhận diện khu vực
          và chấm điểm đúng bối cảnh địa phương.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        {REGIONS.map((r) => (
          <div
            key={r.name}
            className="group rounded-[18px] border border-slate-200 bg-white p-5 md:p-6 hover:border-navy/30 hover:shadow-[0_16px_40px_-20px_rgba(11,29,58,0.35)] transition"
          >
            <div className="text-[14px] font-black text-navy flex items-center gap-2">
              <span className="w-8 h-8 rounded-[10px] bg-navy text-gold flex items-center justify-center text-[13px] font-black">
                {r.name.replace("Miền ", "")[0]}
              </span>
              {r.name}
            </div>
            <div className="mt-2.5 text-[12px] text-slate-500 leading-relaxed">{r.cities}</div>
          </div>
        ))}
      </div>

      <div className="text-center max-w-[640px] mx-auto mt-12">
        <Eyebrow>Cách AI chấm điểm</Eyebrow>
        <h3 className="mt-3 text-[20px] md:text-[26px] font-black tracking-tight text-navy">
          6 tiêu chí cho mỗi tin
        </h3>
      </div>
      <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
        {CRITERIA.map((c, i) => (
          <div
            key={c.name}
            className="rounded-[18px] border border-slate-200 bg-white p-4 md:p-5 hover:border-gold/60 hover:shadow-[0_16px_40px_-20px_rgba(201,168,106,0.5)] transition"
          >
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-[12px] bg-cream border border-slate-200 flex items-center justify-center text-[17px] shrink-0">
                {c.icon}
              </span>
              <div className="text-[13px] font-bold text-navy">
                <span className="text-slate-400 font-semibold mr-1">0{i + 1}</span>
                {c.name}
              </div>
            </div>
            <div className="mt-2.5 text-[11px] md:text-[12px] text-slate-500 leading-snug">{c.desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
