// Section bán tính năng quét danh mục: dán link → lọc → check hàng loạt
// Minh hoạ bằng bản mock (không phải ảnh chụp) + CTA về trang thanh toán

const STEPS = [
  {
    icon: "🗂",
    title: "1. Dán link trang danh mục",
    desc: "Nhà Tốt / Chợ Tốt: link quận, huyện hoặc tỉnh đều đọc được.",
  },
  {
    icon: "🎛",
    title: "2. Lọc đúng kèo cần tìm",
    desc: "Khoảng giá, diện tích, số phòng ngủ, hoặc ghi đè quận/tỉnh khác link.",
  },
  {
    icon: "✅",
    title: "3. Chọn tin rồi check hàng loạt",
    desc: "Mỗi tin chấm 6 tiêu chí, hiện điểm + SĐT người đăng + link mở tin gốc.",
  },
];

export function ScanFeature() {
  return (
    <section id="quet-danh-muc" className="relative overflow-hidden bg-navy scroll-mt-20">
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 100%, black 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 50% 100%, black 30%, transparent 75%)",
        }}
      />
      <div className="absolute -top-24 left-[-120px] w-[440px] h-[440px] bg-gold/15 rounded-full blur-[90px]" />

      <div className="relative mx-auto max-w-[1120px] px-5 md:px-8 py-12 md:py-16">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gold/15 border border-gold/30 text-[11px] tracking-[0.1em] text-gold font-bold">
              🗂 QUÉT DANH MỤC
            </div>
            <h2 className="mt-4 text-[24px] md:text-[34px] font-black leading-[1.08] tracking-tight text-white">
              Dán 1 link danh mục,
              <br />
              lọc ra <span className="text-gold">cả trang kèo ngon</span>
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-slate-300">
              Không cần copy từng tin. Tool quét danh sách tin bán trên Chợ Tốt / Nhà Tốt, lọc theo
              giá — diện tích — số phòng — khu vực, rồi chấm điểm hàng loạt kèm SĐT người đăng.
            </p>

            <div className="mt-6 space-y-4">
              {STEPS.map((s) => (
                <div key={s.title} className="flex gap-3.5">
                  <span className="w-10 h-10 shrink-0 rounded-[12px] bg-white/10 border border-white/15 flex items-center justify-center text-[18px]">
                    {s.icon}
                  </span>
                  <div>
                    <div className="text-[14px] font-bold text-white">{s.title}</div>
                    <div className="mt-0.5 text-[12px] text-slate-400">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="/pricing#thanh-toan"
                className="h-[46px] px-6 rounded-[12px] bg-gold text-navy text-[14px] font-bold flex items-center hover:bg-[#d8ba7f] transition"
              >
                Mở khoá quét 50 tin/lần →
              </a>
              <a
                href="/login"
                className="h-[46px] px-6 rounded-[12px] border border-white/25 text-white text-[14px] font-semibold flex items-center hover:bg-white/10 transition"
              >
                Dùng thử Free 10 tin/lần
              </a>
            </div>
          </div>

          {/* Bản mock giao diện quét — không phải ảnh chụp, dựng bằng HTML */}
          <div className="rounded-[20px] overflow-hidden border border-white/15 bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <span className="ml-2 text-[11px] font-semibold text-slate-500 truncate">
                nhatot.com/mua-ban-nha-dat-quan-go-vap-tp-ho-chi-minh
              </span>
            </div>

            <div className="p-4 space-y-2.5">
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="px-2.5 py-1 rounded-full bg-navy text-white font-semibold">Giá 3–8 tỷ</span>
                <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border">Diện tích 50–120 m²</span>
                <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border">3+ phòng ngủ</span>
                <span className="px-2.5 py-1 rounded-full bg-gold text-navy font-bold">Quận Gò Vấp</span>
              </div>

              {[
                { t: "Nhà hẻm xe hơi 60m², gần công viên", p: "5.2 tỷ", s: "82/100", tag: "KÈO NGỘP NGON", n: "Chủ nhà: 0909 123 456" },
                { t: "Mặt tiền đường lớn, 4 tầng, sổ hồng", p: "7.9 tỷ", s: "71/100", tag: "TIỀM NĂNG CAO", n: "Người đăng: Anh Tuấn" },
                { t: "Nhà mới xây 3PN, hẻm thông 2 xe", p: "4.4 tỷ", s: "64/100", tag: "CÂN NHẮC", n: "Xem SĐT trên tin ↗" },
              ].map((r) => (
                <div key={r.t} className="rounded-[12px] border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[12px] font-bold text-navy leading-snug line-clamp-1">{r.t}</div>
                    <div className="text-[12px] font-black text-emerald-700 whitespace-nowrap">{r.p}</div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                        r.s.startsWith("8") ? "bg-emerald-600 text-white" : "bg-amber-400 text-amber-950"
                      }`}
                    >
                      {r.s}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        r.tag === "KÈO NGỘP NGON"
                          ? "bg-emerald-600 text-white"
                          : r.tag === "TIỀM NĂNG CAO"
                            ? "bg-navy text-white"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {r.tag}
                    </span>
                    <span className="text-[10px] text-slate-500">{r.n}</span>
                  </div>
                </div>
              ))}

              <div className="rounded-[10px] bg-cream border border-slate-200 px-3 py-2 text-[11px] text-slate-500">
                Tìm thấy <b className="text-navy">3.049 tin bán</b> trong khu vực — đã lọc 3 tin khớp tiêu chí
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
