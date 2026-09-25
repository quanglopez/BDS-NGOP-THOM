import { marketAreas } from "@/lib/market-data";

// Bảng giá thị trường Vũng Tàu
export function MarketTable() {
  return (
    <section className="mx-auto max-w-[1120px] px-5 md:px-8 py-10">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[22px] md:text-[28px] font-black tracking-tight text-navy">
            Giá thị trường Vũng Tàu • Live
          </h2>
          <p className="mt-1 text-[13px] text-slate-500">
            AI tổng hợp từ 3,200 tin Batdongsan / Chotot 7 ngày qua. Cập nhật mỗi 2h.
          </p>
        </div>
        <div className="text-[11px] px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-600">
          Nguồn: Batdongsan.com.vn • Alonhadat • Chotot
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-cream border-b border-slate-200 text-[11px] tracking-widest font-bold text-slate-500">
              <tr>
                <th className="px-5 py-3">KHU VỰC</th>
                <th className="px-5 py-3">GIÁ TB TR / M²</th>
                <th className="px-5 py-3">BIẾN ĐỘNG</th>
                <th className="px-5 py-3">ĐÁNH GIÁ AI</th>
              </tr>
            </thead>
            <tbody>
              {marketAreas.map((c) => (
                <tr key={c.khu} className="border-b border-slate-100 last:border-0 hover:bg-[#FFFEFB]">
                  <td className="px-5 py-3.5 font-semibold text-navy flex items-center gap-2">
                    {c.hot && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                    {c.khu}
                    {c.hot && (
                      <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                        HOT
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 font-mono font-bold">{c.avg}tr/m²</td>
                  <td className="px-5 py-3.5">
                    <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 text-[11px] font-bold">
                      {c.tang}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">
                    {c.hot ? "Ngộp thơm nhiều, thanh khoản cao" : "Ổn định, thích hợp ở thực"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 bg-navy text-[11px] text-slate-300 flex flex-wrap gap-3">
          <span>💡 Tip: Thùy Vân mặt tiền 80m² giá 5.5 tỷ = 68.7tr/m² → rẻ hơn TB 24% → auto báo KÈO NGỘP</span>
          <span className="hidden md:inline text-slate-500">•</span>
          <span className="text-amber-200">AI tính toán trên diện tích thực, loại trừ tin ảo.</span>
        </div>
      </div>
    </section>
  );
}
