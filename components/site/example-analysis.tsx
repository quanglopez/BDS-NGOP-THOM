// Ví dụ phân tích 1 tin — số liệu mẫu để minh hoạ cách chấm điểm, không phải dữ liệu thật
const REASONS = [
  { delta: 18, label: "Giá thấp hơn mặt bằng khu vực", note: "5.5 tỷ cho 80m² ≈ 69tr/m², khu vực quanh 75–85tr/m²" },
  { delta: 16, label: "Sổ hồng riêng, hoàn công đầy đủ", note: "Pháp lý rõ ràng, dễ vay bank và sang tên" },
  { delta: 15, label: "Vị trí mặt tiền biển", note: "Trục Thùy Vân — khu vực có nhu cầu ở thực và khai thác du lịch" },
  { delta: 14, label: "Chủ cần bán nhanh", note: "Xuất hiện từ khóa bán gấp, ngân hàng thanh lý" },
  { delta: 12, label: "Thanh khoản khu vực cao", note: "Mặt tiền — dễ bán lại sau 6–12 tháng" },
  { delta: -8, label: "Hẻm xe hơi, không phải mặt tiền lớn", note: "Kén khách hơn so với mặt tiền đường lớn" },
];

export function ExampleAnalysis() {
  return (
    <section className="mx-auto max-w-[1120px] px-5 md:px-8 py-12 md:py-16">
      <div className="text-center max-w-[640px] mx-auto">
        <div className="text-[11px] font-black tracking-[0.2em] uppercase text-[#a5823f]">Ví dụ</div>
        <h2 className="mt-3 text-[24px] md:text-[32px] font-black tracking-tight text-navy">
          Điểm AI không phải con số vô nghĩa
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-slate-500">
          Mỗi điểm có lý do. Bạn biết vì sao tin này đáng gọi — để nói chuyện với chủ nhà thuyết phục hơn.
        </p>
      </div>

      <div className="mt-8 rounded-[20px] border border-slate-200 bg-white shadow-[0_16px_50px_-24px_rgba(11,29,58,0.3)] overflow-hidden max-w-[780px] mx-auto">
        <div className="px-6 py-5 bg-gradient-to-br from-navy via-[#132A56] to-navy flex items-center gap-5">
          <div className="w-[84px] h-[84px] shrink-0 rounded-full bg-white border-[6px] border-emerald-500 text-emerald-700 flex items-center justify-center">
            <div className="text-center leading-none">
              <div className="text-[28px] font-black tracking-tight">85</div>
              <div className="text-[10px] font-bold tracking-widest mt-0.5 opacity-70">/100</div>
            </div>
          </div>
          <div>
            <div className="inline-flex px-3 py-1 rounded-full text-[11px] font-black tracking-[0.12em] bg-emerald-600 text-white">
              KÈO NGỘP NGON
            </div>
            <div className="mt-2 text-[13px] text-slate-200">
              Nhà mặt tiền Thùy Vân • 80m² • 5,5 tỷ • Vũng Tàu
            </div>
          </div>
        </div>

        <div className="p-6 md:p-7">
          <div className="text-[13px] font-black text-navy">Tại sao tin này được 85 điểm?</div>
          <div className="mt-4 space-y-3">
            {REASONS.map((r) => (
              <div key={r.label} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 w-[52px] shrink-0 text-right text-[14px] font-black tabular-nums ${
                    r.delta > 0 ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {r.delta > 0 ? `+${r.delta}` : r.delta}
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-slate-800">{r.label}</div>
                  <div className="text-[12px] text-slate-500 leading-snug">{r.note}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 pt-4 border-t border-slate-200 text-[11px] text-slate-400">
            Số liệu trong ví dụ là minh hoạ cho cách chấm điểm — kết quả thực tế phụ thuộc nội dung tin bạn dán.
          </div>
        </div>
      </div>
    </section>
  );
}
