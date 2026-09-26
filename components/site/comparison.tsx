// Bảng so sánh: làm thủ công vs dùng tool
const ROWS: { label: string; manual: string; tool: string }[] = [
  { label: "Lọc 100 tin/ngày", manual: "3-4 giờ đọc tay", tool: "1 phút (Bulk Check)" },
  { label: "So sánh giá thị trường", manual: "Nhớ giá theo cảm tính", tool: "So sánh giá theo khu vực của tin" },
  { label: "Phát hiện bán gấp", manual: "Đọc kỹ từng tin", tool: "AI bắt từ khóa ngộp tự động" },
  { label: "Đánh giá pháp lý", manual: "Hỏi môi giới khác", tool: "Chấm % an toàn theo sổ" },
  { label: "Bỏ lỡ kèo ngon", manual: "Thường xuyên", tool: "Gần như không - kèo >80 nổi lên đầu" },
  { label: "Chi phí", manual: "0đ + hàng trăm giờ", tool: "299k/tháng" },
];

export function Comparison() {
  return (
    <section id="so-sanh" className="mx-auto max-w-[1120px] px-5 md:px-8 py-12 md:py-16 scroll-mt-20">
      <div className="text-center max-w-[560px] mx-auto">
        <div className="text-[11px] font-black tracking-[0.2em] uppercase text-[#a5823f]">
          Tại sao dùng tool
        </div>
        <h2 className="mt-3 text-[24px] md:text-[32px] font-black tracking-tight text-navy">
          Làm thủ công vs Dùng tool
        </h2>
        <p className="mt-3 text-[14px] text-slate-500">
          Cùng 100 tin/ngày, khác nhau ở chỗ ai phát hiện kèo ngộp trước.
        </p>
      </div>

      <div className="mt-8 overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_16px_50px_-24px_rgba(11,29,58,0.3)]">
        <table className="w-full text-left text-[13px]">
          <thead className="text-[11px] tracking-widest font-bold">
            <tr>
              <th className="px-5 py-4 bg-cream border-b border-slate-200 text-slate-500">TIÊU CHÍ</th>
              <th className="px-5 py-4 bg-cream border-b border-slate-200 text-slate-500">LÀM THỦ CÔNG</th>
              <th className="px-5 py-4 bg-navy text-white border-b border-navy">
                <span className="flex items-center gap-2">
                  DÙNG TOOL
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-gold text-navy font-black tracking-widest">
                    PRO
                  </span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60 transition">
                <td className="px-5 py-3.5 font-semibold text-navy">{r.label}</td>
                <td className="px-5 py-3.5 text-slate-500">
                  <span className="mr-1.5 text-red-400 font-bold">✕</span>
                  {r.manual}
                </td>
                <td className="px-5 py-3.5 text-slate-800 bg-[#FFFEFB] font-medium">
                  <span className="mr-1.5 text-emerald-500 font-bold">✓</span>
                  {r.tool}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
