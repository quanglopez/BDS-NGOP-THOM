"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { dealBadgeClass, dealLabel, scoreBadgeClass } from "@/lib/format";

interface BulkRow {
  text: string;
  score: number | null;
  dealType: string | null;
  isNgop: number | null;
  error?: string;
}

const MAX_LINES = 100;
const CONCURRENCY = 3;

// Bulk Check: upload .txt/.csv 100 tin Zalo -> chạy vòng lặp gọi /api/check -> bảng kết quả
export function BulkCheck({ isPro }: { isPro: boolean }) {
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [onlyGood, setOnlyGood] = useState(false);

  // Đọc file -> mảng tin (mỗi dòng 1 tin)
  const handleFile = async (file: File) => {
    const raw = await file.text();
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^"|"$/g, ""))
      .filter((l) => l.length >= 20)
      .slice(0, MAX_LINES);
    setRows(lines.map((text) => ({ text, score: null, dealType: null, isNgop: null })));
    setDoneCount(0);
  };

  // Chạy check tuần tự 3 request song song
  const runBulk = async () => {
    if (rows.length === 0 || running) return;
    setRunning(true);
    setDoneCount(0);

    const results = rows.map((r) => ({ ...r }));
    let cursor = 0;

    const worker = async () => {
      while (cursor < results.length) {
        const i = cursor++;
        try {
          const res = await fetch("/api/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: results[i].text }),
          });
          const data = await res.json();
          if (!res.ok || data.error) {
            results[i] = { ...results[i], error: data.error || `Lỗi ${res.status}` };
          } else {
            results[i] = {
              ...results[i],
              score: data.investment_score,
              dealType: data.deal_type,
              isNgop: data.is_ngop,
            };
          }
        } catch {
          results[i] = { ...results[i], error: "Lỗi mạng" };
        }
        setRows(results.map((r) => ({ ...r })));
        setDoneCount((c) => c + 1);
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
  };

  // Xuất Excel (SheetJS, lazy-load để không kéo nặng bundle dashboard)
  const exportExcel = async () => {
    const done = rows.filter((r) => r.score !== null && (!onlyGood || (r.score ?? 0) >= 80));
    if (done.length === 0) return;

    const XLSX = await import("xlsx");
    const sheetData = done.map((r, i) => ({
      STT: i + 1,
      "Tin rao": r.text,
      "Điểm": r.score,
      "Loại kèo": dealLabel(r.dealType),
      "Ngộp %": r.isNgop,
    }));
    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Keo ngon");
    XLSX.writeFile(wb, `keo-ngon-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const visible = rows.filter((r) => !onlyGood || (r.score ?? 0) >= 80);
  const goodCount = rows.filter((r) => (r.score ?? 0) >= 80).length;

  return (
    <div className="mt-8 rounded-[18px] border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-black tracking-tight text-navy">Bulk Check</h2>
          <p className="mt-1 text-[12px] text-slate-500">
            Upload .txt / .csv (mỗi dòng 1 tin, tối đa {MAX_LINES} tin) → AI chấm điểm hàng loạt
            {!isPro && " • Bulk là tính năng gói Pro"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="h-9 px-4 rounded-full border border-slate-200 bg-white text-[12px] font-bold text-slate-700 flex items-center cursor-pointer hover:bg-slate-50">
            📁 Chọn file
            <input
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              className="hidden"
              disabled={running}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </label>

          <Button
            type="button"
            onClick={runBulk}
            disabled={running || rows.length === 0}
            className="h-9 px-5 rounded-full text-[12px] font-bold"
          >
            {running ? `Đang check ${doneCount}/${rows.length}...` : `Check ${rows.length} tin`}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={exportExcel}
            disabled={rows.every((r) => r.score === null)}
            className="h-9 px-4 rounded-full text-[12px] font-bold"
          >
            📊 Xuất Excel
          </Button>
        </div>
      </div>

      {rows.length > 0 && (
        <>
          {running && (
            <div className="mt-4 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-navy transition-all"
                style={{ width: `${(doneCount / rows.length) * 100}%` }}
              />
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px]">
            <label className="flex items-center gap-2 text-slate-600 font-semibold">
              <input
                type="checkbox"
                checked={onlyGood}
                onChange={(e) => setOnlyGood(e.target.checked)}
                className="w-4 h-4 accent-[#0B1D3A]"
              />
              Chỉ hiện kèo &gt;80 điểm ({goodCount})
            </label>
            <span className="text-slate-400">Hiển thị {visible.length}/{rows.length} tin</span>
          </div>

          <div className="mt-3 overflow-hidden rounded-[14px] border border-slate-200">
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-cream border-b border-slate-200 text-[11px] tracking-widest font-bold text-slate-500 sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5">TIN</th>
                    <th className="px-4 py-2.5">ĐIỂM</th>
                    <th className="px-4 py-2.5">LOẠI KÈO</th>
                    <th className="px-4 py-2.5">NGỘP</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-[#FFFEFB]">
                      <td className="px-4 py-2.5 max-w-[420px]">
                        <div className="truncate text-slate-700">{r.text}</div>
                        {r.error && <div className="text-[11px] text-red-600">{r.error}</div>}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.score === null ? (
                          <span className="text-slate-400">{running ? "..." : "-"}</span>
                        ) : (
                          <span className={`px-2 py-1 rounded-full text-[11px] font-bold ${scoreBadgeClass(r.score)}`}>
                            {r.score}/100
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.dealType && (
                          <span className={`px-2 py-1 rounded-full text-[11px] font-bold ${dealBadgeClass(r.dealType)}`}>
                            {dealLabel(r.dealType)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono">{r.isNgop !== null ? `${r.isNgop}%` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
