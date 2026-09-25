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

export function Coverage() {
  return (
    <section className="mx-auto max-w-[1120px] px-5 md:px-8 py-10">
      <div className="text-center max-w-[620px] mx-auto">
        <h2 className="text-[22px] md:text-[28px] font-black tracking-tight text-navy">
          Hỗ trợ 63 tỉnh/thành trên cả nước
        </h2>
        <p className="mt-2 text-[13px] text-slate-500">
          Dán tin có tên tỉnh, quận/huyện hoặc đường phố — AI tự nhận diện khu vực và chấm điểm cho đúng bối cảnh địa
          phương.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        {REGIONS.map((r) => (
          <div key={r.name} className="rounded-[16px] border border-slate-200 bg-white p-5">
            <div className="text-[13px] font-black text-navy">{r.name}</div>
            <div className="mt-1 text-[12px] text-slate-500 leading-relaxed">{r.cities}</div>
          </div>
        ))}
      </div>

      <h3 className="mt-10 text-[18px] font-black tracking-tight text-navy text-center">
        6 tiêu chí AI chấm mỗi tin
      </h3>
      <div className="mt-5 grid grid-cols-2 md:grid-cols-3 gap-4">
        {CRITERIA.map((c) => (
          <div key={c.name} className="rounded-[16px] border border-slate-200 bg-white p-4">
            <div className="text-[13px] font-bold text-navy flex items-center gap-2">
              <span>{c.icon}</span> {c.name}
            </div>
            <div className="mt-1 text-[11px] text-slate-500 leading-snug">{c.desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
