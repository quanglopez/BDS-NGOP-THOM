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
    <section className="mx-auto max-w-[1120px] px-5 md:px-8 py-10">
      <div className="text-center max-w-[560px] mx-auto">
        <h2 className="text-[22px] md:text-[28px] font-black tracking-tight text-navy">
          Làm thủ công vs Dùng tool
        </h2>
        <p className="mt-2 text-[13px] text-slate-500">
          Cùng 100 tin/ngày, khác nhau ở chỗ ai phát hiện kèo ngộp trước.
        </p>
      </div>

      <div className="mt-6 overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-cream border-b border-slate-200 text-[11px] tracking-widest font-bold text-slate-500">
            <tr>
              <th className="px-5 py-3">TIÊU CHÍ</th>
              <th className="px-5 py-3">LÀM THỦ CÔNG</th>
              <th className="px-5 py-3 bg-navy text-white">DÙNG TOOL</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3.5 font-semibold text-navy">{r.label}</td>
                <td className="px-5 py-3.5 text-slate-500">❌ {r.manual}</td>
                <td className="px-5 py-3.5 text-slate-800 bg-[#FFFEFB]">✅ {r.tool}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
