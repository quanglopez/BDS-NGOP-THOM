"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROVINCES } from "@/lib/provinces";
import {
  scanCategory,
  type CategoryScanItem,
  type CategoryScanOk,
  type ScanFiltersInput,
  type AreaOverrideInput,
} from "@/lib/client-category";
import { dealBadgeClass, dealLabel, scoreBadgeClass } from "@/lib/format";

interface CheckedRow {
  item: CategoryScanItem;
  score: number | null;
  dealType: string | null;
  isNgop: number | null;
  error: string | null;
}

const CONCURRENCY = 3;

// Tab "Danh mục": dán link trang danh mục Chợ Tốt/Nhà Tốt -> quét ra tin bán ->
// chọn tin -> check hàng loạt bằng /api/check (đã đăng nhập nên AI thật + lưu lịch sử).
export function CategoryScan() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<"idle" | "scanning" | "picked" | "checking" | "done">("idle");
  const [scan, setScan] = useState<CategoryScanOk | null>(null);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<CheckedRow[]>([]);
  const [doneCount, setDoneCount] = useState(0);

  // Bộ lọc quét: giá (tỷ), diện tích (m²), số phòng ngủ (tối thiểu), khu vực (ghi đè link)
  const [showFilters, setShowFilters] = useState(false);
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [areaMin, setAreaMin] = useState("");
  const [areaMax, setAreaMax] = useState("");
  const [minRooms, setMinRooms] = useState("");
  const [provincePick, setProvincePick] = useState("");
  const [wardPick, setWardPick] = useState("");

  const filterSummary = (): string => {
    const parts: string[] = [];
    if (priceMin || priceMax) parts.push(`giá ${priceMin || "0"}-${priceMax || "?"} tỷ`);
    if (areaMin || areaMax) parts.push(`dt ${areaMin || "0"}-${areaMax || "?"} m²`);
    if (minRooms) parts.push(`${minRooms}+ phòng`);
    if (provincePick || wardPick) parts.push(`khu vực ${wardPick ? `${wardPick}, ` : ""}${provincePick}`);
    return parts.join(" • ");
  };

  const buildFilters = (): ScanFiltersInput | null => {
    const n = (v: string) => (v.trim() ? Number(v.replace(",", ".")) : null);
    const f: ScanFiltersInput = {
      priceMin: n(priceMin),
      priceMax: n(priceMax),
      areaMin: n(areaMin),
      areaMax: n(areaMax),
      minRooms: minRooms ? Number(minRooms) : null,
    };
    return Object.values(f).some((v) => v != null) ? f : null;
  };

  const buildAreaOverride = (): AreaOverrideInput | null => {
    if (!provincePick && !wardPick.trim()) return null;
    return { provinceName: provincePick || null, wardSlug: wardPick.trim() || null };
  };

  const handleScan = async () => {
    if (!url.trim() || phase === "scanning") return;
    setPhase("scanning");
    setNotice("");
    setScan(null);
    setSelected(new Set());
    setRows([]);

    const r = await scanCategory(url.trim(), buildFilters(), buildAreaOverride());
    if (!r.ok) {
      setPhase("idle");
      setNotice(r.message);
      return;
    }

    setScan(r);
    setSelected(new Set(r.items.slice(0, Math.min(10, r.items.length)).map((i) => i.id)));
    setPhase("picked");
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!scan) return;
    setSelected((prev) =>
      prev.size === scan.items.length ? new Set() : new Set(scan.items.map((i) => i.id)),
    );
  };

  const handleCheck = async () => {
    if (!scan || selected.size === 0 || phase === "checking") return;
    const targets: CheckedRow[] = scan.items
      .filter((i) => selected.has(i.id))
      .map((item) => ({ item, score: null, dealType: null, isNgop: null, error: null }));

    setRows(targets);
    setDoneCount(0);
    setPhase("checking");
    setNotice("");

    let cursor = 0;
    let stopped = false;

    const worker = async () => {
      while (cursor < targets.length && !stopped) {
        const i = cursor++;
        try {
          const res = await fetch("/api/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: targets[i].item.text }),
          });
          const data = await res.json();
          if (res.status === 429) {
            stopped = true;
            setNotice(data.error || "Đã hết lượt check hôm nay.");
          } else if (!res.ok || data.error) {
            targets[i] = { ...targets[i], error: data.error || `Lỗi ${res.status}` };
          } else {
            targets[i] = {
              ...targets[i],
              score: data.investment_score,
              dealType: data.deal_type,
              isNgop: data.is_ngop,
            };
          }
        } catch {
          targets[i] = { ...targets[i], error: "Lỗi mạng" };
        }
        setRows(targets.map((r) => ({ ...r })));
        setDoneCount((c) => c + 1);
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setPhase("done");
    router.refresh();
  };

  const fmtPrice = (v: number | null) => {
    if (v === null) return "";
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(v % 1_000_000_000 === 0 ? 0 : 2)} tỷ`;
    if (v >= 1_000_000) return `${Math.round(v / 1_000_000)} tr`;
    return String(v);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2.5">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Dán link trang danh mục, vd nhatot.com/mua-ban-nha-dat-quan-go-vap-tp-ho-chi-minh"
          className="h-[46px] rounded-[12px] bg-cream border-slate-200 text-[13px]"
        />
        <Button
          type="button"
          onClick={handleScan}
          disabled={!url.trim() || phase === "scanning"}
          className="h-[46px] px-5 rounded-[12px] bg-navy text-white text-[13px] font-bold shrink-0"
        >
          {phase === "scanning" ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Đang quét...
            </>
          ) : (
            <>🗂 Quét danh mục</>
          )}
        </Button>
      </div>

      {/* Bộ lọc quét */}
      <div className="mt-2.5">
        <button
          type="button"
          onClick={() => setShowFilters((s) => !s)}
          className="text-[12px] font-semibold text-navy hover:underline underline-offset-2"
        >
          {showFilters ? "▾" : "▸"} Bộ lọc (khu vực, giá, diện tích, phòng ngủ)
          {filterSummary() && <span className="ml-2 text-slate-500 font-normal">({filterSummary()})</span>}
        </button>

        {showFilters && (
          <div className="mt-2.5 rounded-[12px] border border-slate-200 bg-cream p-3.5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <label className="text-[11px] font-semibold text-slate-500">
                Giá từ (tỷ)
                <Input
                  value={priceMin}
                  onChange={(e) => setPriceMin(e.target.value)}
                  inputMode="decimal"
                  placeholder="vd 2"
                  className="mt-1 h-10 rounded-[10px] bg-white border-slate-200 text-[13px]"
                />
              </label>
              <label className="text-[11px] font-semibold text-slate-500">
                Giá đến (tỷ)
                <Input
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value)}
                  inputMode="decimal"
                  placeholder="vd 5"
                  className="mt-1 h-10 rounded-[10px] bg-white border-slate-200 text-[13px]"
                />
              </label>
              <label className="text-[11px] font-semibold text-slate-500">
                Diện tích từ (m²)
                <Input
                  value={areaMin}
                  onChange={(e) => setAreaMin(e.target.value)}
                  inputMode="decimal"
                  placeholder="vd 50"
                  className="mt-1 h-10 rounded-[10px] bg-white border-slate-200 text-[13px]"
                />
              </label>
              <label className="text-[11px] font-semibold text-slate-500">
                Diện tích đến (m²)
                <Input
                  value={areaMax}
                  onChange={(e) => setAreaMax(e.target.value)}
                  inputMode="decimal"
                  placeholder="vd 120"
                  className="mt-1 h-10 rounded-[10px] bg-white border-slate-200 text-[13px]"
                />
              </label>
              <label className="text-[11px] font-semibold text-slate-500">
                Số phòng ngủ (từ)
                <select
                  value={minRooms}
                  onChange={(e) => setMinRooms(e.target.value)}
                  className="mt-1 h-10 w-full rounded-[10px] bg-white border border-slate-200 px-2.5 text-[13px]"
                >
                  <option value="">Tất cả</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}+
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] font-semibold text-slate-500">
                Tỉnh/Thành (ghi đè link)
                <select
                  value={provincePick}
                  onChange={(e) => setProvincePick(e.target.value)}
                  className="mt-1 h-10 w-full rounded-[10px] bg-white border border-slate-200 px-2.5 text-[13px]"
                >
                  <option value="">Theo link</option>
                  {PROVINCES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 text-[11px] font-semibold text-slate-500">
                Quận/Huyện (ghi đè link)
                <Input
                  value={wardPick}
                  onChange={(e) => setWardPick(e.target.value)}
                  placeholder="vd Gò Vấp, hoặc để trống theo link"
                  className="mt-1 h-10 rounded-[10px] bg-white border-slate-200 text-[13px]"
                />
              </label>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Để trống = không lọc. Khu vực ghi đè sẽ thay cho quận/tỉnh trong link danh mục bạn dán.
            </p>
          </div>
        )}
      </div>

      {notice && (
        <div className="mt-2.5 rounded-[10px] bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800">
          {notice}
        </div>
      )}

      {scan && (
        <div className="mt-4">
          <div className="rounded-[12px] bg-cream border border-slate-200 px-4 py-3 text-[12px] text-slate-600 leading-relaxed">
            Đang lọc: <b className="text-navy">{scan.scope.kindLabel}</b>
            {scan.scope.ward && <> • <b className="text-navy">{scan.scope.ward.replace(/-/g, " ")}</b></>}
            {scan.scope.region && <> • <b className="text-navy">{scan.scope.region}</b></>}
            {" "}— tìm thấy <b className="text-navy">{scan.scope.total.toLocaleString("vi-VN")} tin bán</b>
            {scan.scope.filtered && (
              <>
                {" "}• đã lọc {filterSummary() || "giá/diện tích/phòng ngủ"} trong{" "}
                <b className="text-navy">{scan.items.length} tin</b> mới nhất
              </>
            )}
            {!scan.scope.filtered && scan.truncated && <> (hiện {scan.items.length} tin mới nhất theo gói của bạn)</>}
            {!scan.scope.exact && (
              <div className="mt-1 text-amber-700">
                Chưa lọc được đúng quận từ link này — danh sách đang ở cấp tỉnh, hãy tick kỹ trước khi check.
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.size === scan.items.length}
                onChange={toggleAll}
                className="w-4 h-4 accent-[#0B1D3A]"
              />
              Chọn tất cả ({selected.size}/{scan.items.length})
            </label>
            <Button
              type="button"
              onClick={handleCheck}
              disabled={selected.size === 0 || phase === "checking"}
              className="h-10 px-5 rounded-[10px] bg-gradient-to-r from-navy to-[#16305f] text-white text-[13px] font-bold disabled:opacity-50"
            >
              {phase === "checking" ? `Đang check ${doneCount}/${rows.length}...` : `🔍 Check ${selected.size} tin đã chọn`}
            </Button>
          </div>

          {phase === "checking" && rows.length > 0 && (
            <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-navy transition-all" style={{ width: `${(doneCount / rows.length) * 100}%` }} />
            </div>
          )}

          <div className="mt-3 space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {scan.items.map((item) => {
              const row = rows.find((r) => r.item.id === item.id);
              return (
                <label
                  key={item.id}
                  className={`flex gap-3 rounded-[12px] border p-3 cursor-pointer transition ${
                    selected.has(item.id) ? "border-navy/40 bg-[#FFFEFB]" : "border-slate-200 bg-white"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    className="mt-1 w-4 h-4 shrink-0 accent-[#0B1D3A]"
                  />
                  {item.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt="" className="w-16 h-16 rounded-[10px] object-cover shrink-0 bg-slate-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-navy leading-snug line-clamp-2">{item.title}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                      {item.priceHint && <span className="font-bold text-emerald-700">{item.priceHint}</span>}
                      {item.areaHint && <span>{item.areaHint}</span>}
                      {item.rooms !== null && <span>{item.rooms} PN</span>}
                      {item.ward && <span>📍 {item.ward}</span>}
                      {item.price !== null && item.price < 1_000_000_000 && (
                        <span className="text-slate-400">({fmtPrice(item.price)})</span>
                      )}
                    </div>
                    {row && (row.score !== null || row.error) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {row.score !== null ? (
                          <>
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${scoreBadgeClass(row.score)}`}>
                              {row.score}/100
                            </span>
                            {row.dealType && (
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${dealBadgeClass(row.dealType)}`}>
                                {dealLabel(row.dealType)}
                              </span>
                            )}
                            {row.isNgop !== null && <span className="text-[11px] font-mono text-slate-500">Ngộp {row.isNgop}%</span>}
                          </>
                        ) : (
                          <span className="text-[11px] text-red-600">{row.error}</span>
                        )}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
