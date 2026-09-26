import { dealBadgeClass, dealLabel, scoreBadgeClass } from "@/lib/format";

export interface CheckRow {
  id: string;
  original_text: string;
  score: number | null;
  deal_type: string | null;
  is_ngop: number | null;
  province: string | null;
  price_billion: number | null;
  area_m2: number | null;
  created_at: string;
}

// Bảng lịch sử 100 tin đã check gần nhất
export function HistoryTable({ rows }: { rows: CheckRow[] }) {
  return (
    <div className="mt-8">
      <h2 className="text-[18px] font-black tracking-tight text-navy">Lịch sử check gần đây</h2>

      <div className="mt-3 overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-cream border-b border-slate-200 text-[11px] tracking-widest font-bold text-slate-500">
              <tr>
                <th className="px-5 py-3">TIN</th>
                <th className="px-5 py-3">KHU VỰC</th>
                <th className="px-5 py-3">ĐIỂM</th>
                <th className="px-5 py-3">LOẠI KÈO</th>
                <th className="px-5 py-3">NGỘP</th>
                <th className="px-5 py-3">THỜI GIAN</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                    Chưa có tin nào. Dán tin vào trang chủ để check.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-[#FFFEFB]">
                    <td className="px-5 py-3.5 max-w-[360px]">
                      <div className="truncate text-slate-700">{r.original_text}</div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {r.province ? (
                        <span className="text-[12px] font-semibold text-navy">{r.province}</span>
                      ) : (
                        <span className="text-[12px] text-slate-400">-</span>
                      )}
                      {r.price_billion != null && (
                        <div className="text-[11px] text-slate-500 font-mono">
                          {r.price_billion} tỷ{r.area_m2 ? ` • ${r.area_m2}m²` : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-1 rounded-full text-[11px] font-bold ${scoreBadgeClass(r.score)}`}>
                        {r.score ?? 0}/100
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-1 rounded-full text-[11px] font-bold ${dealBadgeClass(r.deal_type)}`}>
                        {dealLabel(r.deal_type)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono">{r.is_ngop ?? 0}%</td>
                    <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString("vi-VN")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
