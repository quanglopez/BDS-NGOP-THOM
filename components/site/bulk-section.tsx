"use client";

import Link from "next/link";
import { trackEvent } from "@/lib/analytics";

// Section Bulk Check + quét danh mục — năng lực thật của gói PRO
const ROWS = [
  { t: "Nhà hẻm xe hơi 60m², gần công viên", p: "5.2 tỷ", s: 91, tag: "KÈO NGỘP NGON" },
  { t: "Mặt tiền đường lớn, 4 tầng, sổ hồng", p: "7.9 tỷ", s: 84, tag: "KÈO NGỘP NGON" },
  { t: "Nhà mới xây 3PN, hẻm thông 2 xe", p: "4.4 tỷ", s: 72, tag: "TIỀM NĂNG CAO" },
];

export function BulkSection() {
  return (
    <section className="relative overflow-hidden bg-navy">
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
              🗂 BULK CHECK
            </div>
            <h2 className="mt-4 text-[24px] md:text-[34px] font-black leading-[1.08] tracking-tight text-white">
              Lọc 100 tin trong 1 phút,
              <br />
              <span className="text-gold">nhấc kèo ngon lên đầu</span>
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-slate-300">
              Upload file tin từ Zalo/Facebook, hoặc dán cả trang danh mục Nhà Tốt/Chợ Tốt — CheckBDS
              quét danh sách tin bán, lọc theo giá, diện tích, số phòng và khu vực, rồi chấm điểm hàng loạt.
            </p>

            <ul className="mt-5 space-y-2.5 text-[13px] text-slate-200">
              {[
                "Bulk Check 100 tin/lần — có file .txt/.csv",
                "Quét trang danh mục, tự tách từng tin bán",
                "Bộ lọc giá • diện tích • số phòng • quận/huyện",
                "Kèo >80 điểm nổi lên đầu kèm lý do cộng/trừ",
                "Lưu lịch sử kèm link gốc — quay lại gọi chủ nhà bất cứ lúc nào",
              ].map((f) => (
                <li key={f} className="flex gap-2.5">
                  <span className="text-gold font-bold">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            <div className="mt-7">
              <Link
                href="/pricing"
                onClick={() => trackEvent("upgrade_clicked", { from: "bulk_section" })}
                className="inline-flex h-[50px] px-7 rounded-[12px] bg-gradient-to-r from-[#C9A86A] to-[#d8ba7f] text-navy text-[15px] font-black items-center hover:from-[#d8ba7f] hover:to-[#e3ca92] transition"
              >
                Nâng cấp PRO
              </Link>
            </div>
          </div>

          {/* Bản mock giao diện bulk check — dựng bằng HTML, không phải ảnh chụp */}
          <div className="rounded-[20px] overflow-hidden border border-white/15 bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <span className="text-[11px] font-black tracking-[0.12em] text-slate-500">BULK CHECK — 100 TIN</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                PRO
              </span>
            </div>

            <div className="p-4 space-y-2">
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="px-2.5 py-1 rounded-full bg-navy text-white font-semibold">Giá 3–8 tỷ</span>
                <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border">50–120 m²</span>
                <span className="px-2.5 py-1 rounded-full bg-gold text-navy font-bold">Quận Gò Vấp</span>
              </div>

              {ROWS.map((r) => (
                <div key={r.t} className="rounded-[12px] border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[12px] font-bold text-navy leading-snug line-clamp-1">{r.t}</div>
                    <div className="text-[12px] font-black text-emerald-700 whitespace-nowrap">{r.p}</div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                        r.s >= 80 ? "bg-emerald-600 text-white" : "bg-amber-400 text-amber-950"
                      }`}
                    >
                      {r.s}/100
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        r.tag === "KÈO NGỘP NGON" ? "bg-emerald-600 text-white" : "bg-navy text-white"
                      }`}
                    >
                      {r.tag}
                    </span>
                  </div>
                </div>
              ))}

              <div className="rounded-[10px] bg-cream border border-slate-200 px-3 py-2 text-[11px] text-slate-500">
                Đã lọc <b className="text-navy">3 tin</b> khớp tiêu chí từ 3.049 tin bán trong khu vực
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
