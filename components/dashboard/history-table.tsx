"use client";

import { useMemo, useState } from "react";
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
  bedrooms: number | null;
  created_at: string;
  listing_url: string | null;
}

// Tên miền ngắn để hiện dưới tiêu đề tin (vd nhatot.com)
function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const DEALS = ["ngop_ngon", "thom_dau_tu", "binh_thuong", "rui_ro_phap_ly", "gia_cao"];
const SCORE_BANDS = [
  { key: "all", label: "Tất cả điểm" },
  { key: "hot", label: "Kèo ngon ≥80" },
  { key: "mid", label: "Trung bình 50–79" },
  { key: "low", label: "Rủi ro <50" },
] as const;

// Bảng lịch sử check + bộ lọc (tìm text, loại kèo, khoảng điểm, khu vực)
export function HistoryTable({ rows }: { rows: CheckRow[] }) {
  const [search, setSearch] = useState("");
  const [deal, setDeal] = useState("all");
  const [band, setBand] = useState<(typeof SCORE_BANDS)[number]["key"]>("all");
  const [province, setProvince] = useState("all");

  const provinces = useMemo(
    () => [...new Set(rows.map((r) => r.province).filter((p): p is string => Boolean(p)))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !(r.original_text ?? "").toLowerCase().includes(q)) return false;
      if (deal !== "all" && r.deal_type !== deal) return false;
      if (province !== "all" && r.province !== province) return false;
      const s = r.score ?? 0;
      if (band === "hot" && s < 80) return false;
      if (band === "mid" && (s < 50 || s >= 80)) return false;
      if (band === "low" && s >= 50) return false;
      return true;
    });
  }, [rows, search, deal, band, province]);

  const hasFilter = search.trim() || deal !== "all" || band !== "all" || province !== "all";
  const sel = "h-9 rounded-[10px] border border-slate-200 bg-white px-2.5 text-[12px] font-semibold text-slate-700";

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[18px] font-black tracking-tight text-navy">Lịch sử check gần đây</h2>
        <span className="text-[12px] text-slate-500">
          {hasFilter ? `Đang lọc ${filtered.length}/${rows.length} tin` : `${rows.length} tin`}
        </span>
      </div>

      {/* Bộ lọc */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm trong nội dung tin..."
          className="h-9 w-full sm:w-[240px] rounded-[10px] border border-slate-200 bg-white px-3 text-[12px]"
        />
        <select value={deal} onChange={(e) => setDeal(e.target.value)} className={sel}>
          <option value="all">Tất cả loại kèo</option>
          {DEALS.map((d) => (
            <option key={d} value={d}>
              {dealLabel(d)}
            </option>
          ))}
        </select>
        <select value={band} onChange={(e) => setBand(e.target.value as typeof band)} className={sel}>
          {SCORE_BANDS.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
        </select>
        <select value={province} onChange={(e) => setProvince(e.target.value)} className={sel}>
          <option value="all">Tất cả khu vực</option>
          {provinces.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {hasFilter && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setDeal("all");
              setBand("all");
              setProvince("all");
            }}
            className="h-9 px-3 rounded-[10px] text-[12px] font-bold text-navy hover:bg-slate-100"
          >
            Xoá lọc
          </button>
        )}
      </div>

      <div className="mt-3 overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-cream border-b border-slate-200 text-[11px] tracking-widest font-bold text-slate-500">
              <tr>
                <th className="px-4 py-3">TIN</th>
                <th className="px-4 py-3">KHU VỰC</th>
                <th className="px-4 py-3">GIÁ</th>
                <th className="px-4 py-3">DIỆN TÍCH</th>
                <th className="px-4 py-3">PHÒNG</th>
                <th className="px-4 py-3">ĐIỂM</th>
                <th className="px-4 py-3">LOẠI KÈO</th>
                <th className="px-4 py-3">NGỘP</th>
                <th className="px-4 py-3">THỜI GIAN</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    {rows.length === 0
                      ? "Chưa có tin nào. Dán tin vào ô trên để check."
                      : "Không có tin khớp bộ lọc hiện tại."}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const host = hostOf(r.listing_url);
                  return (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-[#FFFEFB]">
                      <td className="px-4 py-3.5 max-w-[340px]">
                        <div className="truncate text-slate-700">{r.original_text}</div>
                        {r.listing_url ? (
                          <a
                            href={r.listing_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-navy hover:underline"
                          >
                            {host} ↗
                          </a>
                        ) : (
                          <div className="mt-0.5 text-[11px] text-slate-400">Không có link gốc</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {r.province ? (
                          <span className="text-[12px] font-semibold text-navy">{r.province}</span>
                        ) : (
                          <span className="text-[12px] text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap font-mono text-[12px]">
                        {r.price_billion != null ? `${r.price_billion} tỷ` : <span className="text-slate-400">-</span>}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap font-mono text-[12px]">
                        {r.area_m2 != null ? `${r.area_m2} m²` : <span className="text-slate-400">-</span>}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap font-mono text-[12px]">
                        {r.bedrooms != null ? r.bedrooms : <span className="text-slate-400">-</span>}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`px-2 py-1 rounded-full text-[11px] font-bold ${scoreBadgeClass(r.score)}`}>
                          {r.score ?? 0}/100
                        </span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-[11px] font-bold ${dealBadgeClass(r.deal_type)}`}>
                          {dealLabel(r.deal_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-mono">{r.is_ngop ?? 0}%</td>
                      <td className="px-4 py-3.5 text-slate-500 whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString("vi-VN")}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
