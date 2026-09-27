"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics";
import { DISTANCE_FALLBACK_LABEL } from "@/lib/price/pipeline";
import {
  buildPriceViewModel,
  loadPriceIntelligence,
  type PriceLoadResult,
} from "@/lib/price/trigger";

// Skeleton RIÊNG cho phần giá. Tách khỏi skeleton AI Pro.
function PriceSkeleton() {
  return (
    <div className="rounded-[16px] border border-slate-200 bg-white p-5 md:p-6" aria-busy="true">
      <div className="h-4 w-52 rounded bg-slate-200 animate-pulse" />
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-[12px] bg-slate-100 animate-pulse" />
        ))}
      </div>
      <p className="mt-3 text-[12px] text-slate-400">Đang phân tích giá tham chiếu...</p>
    </div>
  );
}

function fmtVnd(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} tỷ`;
  if (v >= 1_000_000) return `${Math.round(v / 1_000_000)} triệu`;
  return v.toLocaleString("vi-VN");
}

function fmtPpm2(v: number | null): string {
  if (v === null) return "—";
  return `${(v / 1_000_000).toFixed(1)} tr/m²`;
}

function fmtArea(v: number | null): string {
  return v === null ? "—" : `${v.toLocaleString("vi-VN")} m²`;
}

/**
 * Section "Phân tích giá tham chiệu" — lazy, độc lập hoàn toàn với AI Pro.
 *   Free -> locked CTA, KHÔNG gọi mạng
 *   Pro  -> GET trước; chỉ POST khi server nói chưa có snapshot
 */
export function PriceIntelligenceSection({ checkId, isPro }: { checkId: string; isPro: boolean }) {
  const [result, setResult] = useState<PriceLoadResult | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isPro) return;
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    (async () => {
      const r = await loadPriceIntelligence({
        checkId,
        isPro,
        fetchImpl: (url, init) => fetch(url, init),
      });
      if (cancelled) return;
      setResult(r);
      trackEvent("price_intelligence_view", {
        checkId,
        state: r.state,
        cached: r.cached ? "true" : "false",
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [checkId, isPro]);

  const vm = buildPriceViewModel(result);

  if (vm.locked) {
    return (
      <section className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 p-5">
        <div className="flex items-start gap-3">
          <span aria-hidden="true">🔒</span>
          <div>
            <h3 className="text-[15px] font-black text-navy">{vm.heading}</h3>
            <p className="mt-1 text-[13px] text-slate-500">
              So sánh giá của tin này với nhóm tin đăng tương tự cùng khu vực.
            </p>
            <Link
              href="/pricing#thanh-toan"
              onClick={() => trackEvent("pro_unlock_click", { checkId, from: "price_intelligence" })}
              className="mt-3 inline-flex h-10 items-center rounded-[10px] bg-navy px-4 text-[13px] font-black text-white hover:bg-[#112a5a] transition"
            >
              Mở khóa Pro
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (vm.showSkeleton) return <PriceSkeleton />;

  // Không đủ / tạm lỗi: hiện lời giải thích, tuyệt đối không hiện số nào.
  if (!result || result.state !== "ready" || vm.message) {
    return (
      <section className="rounded-[16px] border border-amber-200 bg-amber-50 p-5 text-[13px] text-amber-800">
        {vm.message ?? "Phân tích giá tham chiếu tạm thời chưa khả dụng."}
      </section>
    );
  }

  return (
    <section className="rounded-[18px] border border-slate-200 bg-white p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-black text-navy">{vm.heading}</h3>
        {vm.confidence && (
          <span
            title={vm.confidence.tooltip}
            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600"
          >
            Độ tin cậy tham chiếu: {vm.confidence.badge} {vm.confidence.label}
          </span>
        )}
      </div>

      {vm.scopeDescription && (
        <p className="mt-1 text-[12px] text-slate-500">
          {vm.scopeDescription}
          {vm.sampleLine ? ` · ${vm.sampleLine}` : ""}
        </p>
      )}

      {vm.canShowStats ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 text-center md:grid-cols-4">
            <div className="rounded-[12px] border border-slate-200 bg-cream p-3">
              <div className="text-[11px] text-slate-500">Giá/m² của tin</div>
              <div className="mt-1 text-[15px] font-black text-navy">{fmtPpm2(vm.targetPpm2)}</div>
            </div>
            <div className="rounded-[12px] border border-slate-200 bg-cream p-3">
              <div className="text-[11px] text-slate-500">Trung vị nhóm tham chiếu</div>
              <div className="mt-1 text-[15px] font-black text-navy">{fmtPpm2(vm.medianPpm2)}</div>
            </div>
            <div className="rounded-[12px] border border-slate-200 bg-cream p-3">
              <div className="text-[11px] text-slate-500">Khoảng 25%–75%</div>
              <div className="mt-1 text-[15px] font-black text-navy">
                {fmtPpm2(vm.p25Ppm2)}–{fmtPpm2(vm.p75Ppm2)}
              </div>
            </div>
            <div className="rounded-[12px] border border-slate-200 bg-cream p-3">
              <div className="text-[11px] text-slate-500">Chênh lệch</div>
              <div className="mt-1 text-[15px] font-black text-navy">
                {vm.differencePercent === null
                  ? "—"
                  : `${vm.differencePercent > 0 ? "+" : ""}${vm.differencePercent}%`}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[12px] text-slate-500">
            Khoảng giá: {fmtPpm2(vm.minPpm2)} – {fmtPpm2(vm.maxPpm2)} · đã loại{" "}
            {Math.max(0, vm.sampleSize - vm.trimmedSize)} tin ngoài dải thống kê.
          </p>
        </>
      ) : (
        <p className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          Chưa đủ dữ liệu tham chiếu cho khu vực này.
        </p>
      )}

      {vm.comparables.length > 0 && (
        <div className="mt-5">
          <h4 className="text-[12px] font-black tracking-wide text-slate-600">
            TIN ĐĂNG TƯƠNG ĐỒNG
          </h4>
          <ul className="mt-2 space-y-2">
            {vm.comparables.map((c) => {
              const inner = (
                <>
                  <div className="truncate text-[13px] font-bold text-navy">
                    {c.title ?? "Tin đăng"}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-slate-600">
                    <span>{fmtArea(c.size_m2)}</span>
                    <span>{fmtVnd(c.price_vnd)}</span>
                    <span className="font-bold">{fmtPpm2(c.price_per_m2)}</span>
                    <span className="text-slate-400">
                      {c.distance_km === null ? DISTANCE_FALLBACK_LABEL : `${c.distance_km} km`}
                    </span>
                  </div>
                </>
              );
              return (
                <li key={c.external_id}>
                  {c.url ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-[12px] border border-slate-200 p-3 hover:bg-[#FFFEFB]"
                    >
                      {inner}
                    </a>
                  ) : (
                    <div className="rounded-[12px] border border-slate-200 p-3">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {vm.limitations.length > 0 && (
        <div className="mt-4 rounded-[14px] border border-slate-200 bg-slate-50 p-4 text-[12px] leading-relaxed text-slate-500">
          <span className="font-black text-slate-600">Lưu ý: </span>
          {vm.limitations.join(" ")}
        </div>
      )}
    </section>
  );
}
