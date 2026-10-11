"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { dealBadgeClass, dealLabel, scoreBadgeClass } from "@/lib/format";
import { extractFromUrl, isBareUrl } from "@/lib/client-extract";
import { trackEvent } from "@/lib/analytics";
import { UpgradeModal } from "@/components/site/upgrade-modal";
import { reportUrl } from "@/lib/report/slug";
import type { QuotaInfo } from "@/lib/types";
import {
  buildCallQueue,
  countByBand,
  type CallQueueBand,
  type CallQueueStatus,
} from "@/lib/call-queue/queue";
import {
  BAND_LABEL,
  BAND_NOTE,
  BAND_SCALE_NOTE,
  LEGAL_RISK_WARNING,
  ORIGINAL_VIEW_LABEL,
  QUEUE_HEADING,
  QUEUE_SCOPE_NOTE,
  QUEUE_VIEW_LABEL,
  RETRY_HEADING,
  RETRY_NOTE,
  buildQueueSummary,
  hasLegalRisk,
  queueScoreBadgeClass,
  retryStatusLabel,
} from "@/lib/call-queue/wording";

interface BulkRow {
  /** Vị trí gốc trong file — khoá tie-break cuối cùng của hàng đợi. */
  inputIndex: number;
  text: string;
  score: number | null;
  dealType: string | null;
  isNgop: number | null;
  error?: string;
  // Trạng thái tường minh: trước đây dòng chưa chạy và dòng lỗi đều là
  // score null + error null nên không phân biệt được.
  status: CallQueueStatus;
  // Các field /api/check đã trả sẵn — trước đây bị bỏ đi, giờ giữ lại để dựng
  // hàng đợi và CTA báo cáo mà không phải gọi lại API.
  checkId: string | null;
  seoSlug: string | null;
  legalSafety: number | null;
  locationGrowth: number | null;
  liquidity: number | null;
  province: string | null;
  priceBillion: number | null;
  confidence: number | null;
  analyzedAt: string | null;
  cached: boolean;
  /** URL tin gốc khi dòng nhập là link; null khi người dùng dán văn bản. */
  sourceUrl: string | null;
}

const MAX_LINES = 100;
const CONCURRENCY = 3;

/** Dòng mới, chưa chạy. Giữ mọi field ở trạng thái "chưa biết" một cách tường minh. */
function makeRow(text: string, inputIndex: number, sourceUrl: string | null): BulkRow {
  return {
    inputIndex,
    text,
    score: null,
    dealType: null,
    isNgop: null,
    status: "pending",
    checkId: null,
    seoSlug: null,
    legalSafety: null,
    locationGrowth: null,
    liquidity: null,
    province: null,
    priceBillion: null,
    confidence: null,
    analyzedAt: null,
    cached: false,
    sourceUrl,
  };
}

// Bulk Check: upload .txt/.csv 100 tin Zalo -> chạy vòng lặp gọi /api/check -> bảng kết quả
export function BulkCheck({ isPro }: { isPro: boolean }) {
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [onlyGood, setOnlyGood] = useState(false);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [notice, setNotice] = useState("");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Sau lần chấm đầu, mặc định mở hàng đợi ưu tiên gọi; người dùng vẫn xem lại
  // được bảng kết quả gốc.
  const [view, setView] = useState<"queue" | "original">("queue");

  // Lấy quota hôm nay để chặn trước khi gọi hết file
  const loadQuota = useCallback(async () => {
    try {
      const res = await fetch("/api/check");
      if (res.ok) setQuota(await res.json());
    } catch {
      // bỏ qua, coi như không biết quota
    }
  }, []);

  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  // Đọc file -> mảng tin (mỗi dòng 1 tin)
  const handleFile = async (file: File) => {
    const raw = await file.text();
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^"|"$/g, ""))
      .filter((l) => l.length >= 20)
      .slice(0, MAX_LINES);
    // Dòng là link: giữ lại URL gốc để sau này mở "Tin gốc", kể cả khi Pro lấy
    // nội dung trang và thay `text` bằng văn bản đã trích.
    setRows(lines.map((line, i) => makeRow(line, i, isBareUrl(line) ? line : null)));
    setDoneCount(0);
    setView("queue");
  };

  // Chạy check tối đa 3 request song song, tự dừng khi hết lượt
  const runBulk = async () => {
    if (rows.length === 0 || running) return;

    const allowed = quota ? Math.min(rows.length, quota.remaining) : rows.length;
    if (allowed <= 0) {
      setNotice("Hết lượt check hôm nay. Nâng cấp Pro hoặc chờ ngày mai.");
      return;
    }
    if (allowed < rows.length) {
      setNotice(`Hôm nay chỉ còn ${allowed}/${rows.length} lượt — sẽ check ${allowed} tin đầu.`);
    } else {
      setNotice("");
    }

    setRunning(true);
    setDoneCount(0);

    const results = rows.slice(0, allowed).map((r) => ({ ...r, status: "running" as CallQueueStatus }));
    let cursor = 0;
    let stopped = false;

    const worker = async () => {
      while (cursor < results.length && !stopped) {
        const i = cursor++;
        try {
          // Gói Pro: dòng là URL thì lấy nội dung trang trước khi chấm
          let text = results[i].text;
          if (isPro && isBareUrl(text)) {
            const extracted = await extractFromUrl(text);
            if (extracted.ok) {
              text = extracted.text;
            } else {
              results[i] = { ...results[i], status: "error", error: extracted.message };
              setRows(results.map((r) => ({ ...r })));
              setDoneCount((c) => c + 1);
              continue;
            }
          }

          const res = await fetch("/api/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const data = await res.json();

          if (res.status === 429) {
            stopped = true;
            setNotice(data.error || "Đã hết lượt check hôm nay.");
            // Hết lượt giữa chừng: mời nâng cấp với hạn mức thật (không hardcode)
            trackEvent("free_limit_reached", { plan: quota?.plan ?? "unknown", from: "bulk_check" });
            setUpgradeOpen(true);
          } else if (!res.ok || data.error) {
            results[i] = { ...results[i], status: "error", error: data.error || `Lỗi ${res.status}` };
          } else {
            // Giữ lại các field /api/check đã trả để dựng hàng đợi + CTA báo cáo.
            // KHÔNG đổi hình dạng response của server, chỉ đọc thêm field có sẵn.
            results[i] = {
              ...results[i],
              status: "completed",
              score: data.investment_score,
              dealType: data.deal_type,
              isNgop: data.is_ngop,
              checkId: typeof data.check_id === "string" ? data.check_id : null,
              seoSlug: typeof data.seo_slug === "string" ? data.seo_slug : null,
              legalSafety: typeof data.legal_safety === "number" ? data.legal_safety : null,
              locationGrowth: typeof data.location_growth === "number" ? data.location_growth : null,
              liquidity: typeof data.liquidity === "number" ? data.liquidity : null,
              province: typeof data.province === "string" ? data.province : null,
              priceBillion: typeof data.price_billion === "number" ? data.price_billion : null,
              confidence: typeof data.confidence === "number" ? data.confidence : null,
              analyzedAt: typeof data.analyzed_at === "string" ? data.analyzed_at : null,
              cached: data.cached === true,
            };
            if (data.quota) setQuota(data.quota);
          }
        } catch {
          results[i] = { ...results[i], status: "error", error: "Lỗi mạng" };
        }
        setRows(results.map((r) => ({ ...r })));
        setDoneCount((c) => c + 1);
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // Dòng chưa kịp chạy vì hết lượt: đánh dấu "stopped" để không bị hiểu nhầm
    // là tin kém. Chúng vào CẦN THỬ LẠI, không vào xếp hạng.
    if (stopped) {
      const finalRows = results.map((r) =>
        r.status === "running" || r.status === "pending"
          ? { ...r, status: "stopped" as CallQueueStatus }
          : r,
      );
      setRows(finalRows);
    }

    setRunning(false);
    if (!stopped) void loadQuota();
  };

  // Xuất CSV UTF-8 BOM (Excel/WPS mở đúng tiếng Việt, không cần thư viện ngoài)
  const exportCsv = () => {
    const done = rows.filter((r) => r.score !== null && (!onlyGood || (r.score ?? 0) >= 80));
    if (done.length === 0) return;

    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      ["STT", "Tin rao", "Điểm", "Loại kèo", "Ngộp %"].join(","),
      ...done.map((r, i) =>
        [i + 1, esc(r.text), r.score, esc(dealLabel(r.dealType)), r.isNgop].join(","),
      ),
    ];

    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keo-ngon-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const visible = rows.filter((r) => !onlyGood || (r.score ?? 0) >= 80);
  const goodCount = rows.filter((r) => (r.score ?? 0) >= 80).length;

  // Hàng đợi suy ra từ rows hiện tại. Thuần tính toán — không gọi mạng, không
  // tiêu quota. Chạy lại mỗi lần rows đổi nên hàng đợi luôn khớp kết quả.
  const queue = useMemo(() => buildCallQueue(rows), [rows]);
  const bandCounts = useMemo(() => countByBand(queue.ranked), [queue.ranked]);
  const hasRanked = queue.ranked.length > 0;
  const hasRetry = queue.retry.length > 0;

  const BAND_ORDER: CallQueueBand[] = ["call_first", "consider", "later"];

  /**
   * URL báo cáo của một item, hoặc null khi chưa có định danh hợp lệ.
   *
   * Dùng helper reportUrl() sẵn có (ưu tiên seo_slug, rơi về UUID) — không tự
   * dựng đường dẫn. Trả null để KHÔNG render CTA hỏng khi tin chưa lưu được.
   */
  const reportHrefFor = (checkId: string | null, seoSlug: string | null): string | null => {
    if (!checkId && !seoSlug) return null;
    return reportUrl(checkId ?? "", seoSlug);
  };

  return (
    <>
      <div className="mt-8 rounded-[18px] border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-black tracking-tight text-navy">Bulk Check</h2>
          <p className="mt-1 text-[12px] text-slate-500">
            Upload .txt / .csv (mỗi dòng 1 tin, tối đa {MAX_LINES} tin) → AI chấm điểm hàng loạt
            {!isPro && " • Bulk là tính năng gói Pro"}
            {isPro && " • Dòng là link sẽ được tự lấy nội dung trang"}
            {quota && (
              <>
                {" "}
                • <b>Còn {quota.remaining} lượt hôm nay</b> ({quota.used}/{quota.limit}
                {quota.credits > 0 ? ` + ${quota.credits} credits` : ""})
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="h-12 px-4 rounded-full border border-slate-200 bg-white text-[12px] font-bold text-slate-700 flex items-center cursor-pointer hover:bg-slate-50">
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
            disabled={running || rows.length === 0 || (quota?.remaining ?? 1) <= 0}
            className="h-12 px-5 rounded-full text-[12px] font-bold"
          >
            {running ? `Đang check ${doneCount}/${rows.length}...` : `Check ${rows.length} tin`}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={exportCsv}
            disabled={rows.every((r) => r.score === null)}
            className="h-12 px-4 rounded-full text-[12px] font-bold"
          >
            📊 Xuất Excel (CSV)
          </Button>
        </div>
      </div>

      {notice && (
        <div className="mt-3 rounded-[10px] bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800">
          {notice}
        </div>
      )}

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

          {/* Chuyển giữa hàng đợi ưu tiên gọi và bảng kết quả gốc. Thuần đổi
              cách hiển thị — không gọi mạng, không tiêu quota. */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div
              role="tablist"
              aria-label="Cách xem kết quả"
              className="inline-flex rounded-full border border-slate-200 bg-white p-1"
            >
              {([
                ["queue", QUEUE_VIEW_LABEL],
                ["original", ORIGINAL_VIEW_LABEL],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={view === key}
                  onClick={() => setView(key)}
                  className={`h-12 rounded-full px-4 text-[12px] font-bold transition-colors ${
                    view === key ? "bg-navy text-white" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {view === "queue" && (
            <div className="mt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-black text-navy">{QUEUE_HEADING}</h3>
                <span className="text-[12px] font-semibold text-slate-600 tabular-nums">
                  {buildQueueSummary(queue.stats.completed, queue.stats.retry, queue.stats.total)}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{QUEUE_SCOPE_NOTE}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{BAND_SCALE_NOTE}</p>

              {!hasRanked && (
                <p className="mt-3 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
                  {running
                    ? "Đang chấm — hàng đợi sẽ hiện dần khi từng tin có kết quả."
                    : "Chưa có tin nào chấm xong nên chưa xếp hạng được."}
                </p>
              )}

              {BAND_ORDER.map((band) => {
                const items = queue.ranked.filter((it) => it.band === band);
                if (items.length === 0) return null;
                return (
                  <section key={band} className="mt-5" aria-label={BAND_LABEL[band]}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h4 className="text-[13px] font-black tracking-wide text-navy">
                        {BAND_LABEL[band]}
                      </h4>
                      <span className="text-[11px] font-bold tabular-nums text-slate-500">
                        {bandCounts[band]} tin
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">{BAND_NOTE[band]}</p>

                    {/* Card-based: ở 390px bảng xếp hạng ngang sẽ tràn màn hình. */}
                    <ul className="mt-3 space-y-3">
                      {items.map((it) => {
                        const reportHref = reportHrefFor(it.checkId, it.seoSlug);
                        return (
                        <li
                          key={`${it.inputIndex}-${it.rank}`}
                          className="rounded-[14px] border border-slate-200 bg-white p-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-navy px-2.5 py-1 text-[11px] font-black text-white tabular-nums">
                              #{it.rank}
                            </span>
                            <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                              {BAND_LABEL[it.band]}
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${queueScoreBadgeClass(it.score, it.dealType)}`}
                            >
                              {it.score}/100
                            </span>
                            {it.cached && (
                              <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                                Kết quả đã chấm trước đó
                              </span>
                            )}
                            {it.province && (
                              <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                {it.province}
                              </span>
                            )}
                          </div>

                          <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-slate-700">
                            {it.text}
                          </p>

                          {/* Cảnh báo pháp lý hiện NGAY trên card, không chỉ nằm
                              trong danh sách lý do: điểm cao không được che mất
                              cờ rủi ro pháp lý. Theo quy ước scoreRingClass(). */}
                          {hasLegalRisk(it.dealType) && (
                            <p className="mt-2 rounded-[10px] border border-risk-high/40 bg-risk-high-wash px-3 py-2 text-[11px] font-semibold leading-relaxed text-risk-high">
                              {LEGAL_RISK_WARNING}
                            </p>
                          )}

                          <ul className="mt-2 space-y-1">
                            {it.reasons.map((r) => (
                              <li key={r} className="text-[11px] leading-relaxed text-slate-600">
                                • {r}
                              </li>
                            ))}
                          </ul>

                          <p className="mt-2 text-[11px] font-semibold leading-relaxed text-slate-700">
                            Cần hỏi ngay: {it.askPrompt}
                          </p>

                          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                            {reportHref && (
                              <a
                                href={reportHref}
                                className="flex h-12 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-[12px] font-bold text-slate-700 hover:bg-slate-50 sm:w-auto"
                              >
                                Xem báo cáo
                              </a>
                            )}
                            {it.sourceUrl && (
                              <a
                                href={it.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex h-12 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-[12px] font-bold text-slate-700 hover:bg-slate-50 sm:w-auto"
                              >
                                Mở tin gốc
                              </a>
                            )}
                          </div>
                        </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}

              {hasRetry && (
                <section className="mt-6" aria-label={RETRY_HEADING}>
                  <h4 className="text-[13px] font-black tracking-wide text-navy">{RETRY_HEADING}</h4>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{RETRY_NOTE}</p>
                  <ul className="mt-3 space-y-2">
                    {queue.retry.map((r) => (
                      <li
                        key={`retry-${r.inputIndex}`}
                        className="rounded-[14px] border border-slate-200 bg-slate-50 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700">
                            #{r.inputIndex + 1}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-600">
                            {retryStatusLabel(r)}
                          </span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-slate-600">
                          {r.text}
                        </p>
                        {r.sourceUrl && (
                          <a
                            href={r.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex h-12 items-center rounded-md border border-slate-200 bg-white px-4 text-[12px] font-bold text-slate-700 hover:bg-slate-50"
                          >
                            Mở tin gốc
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          {view === "original" && (
            <>
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
        </>
      )}
      </div>

      <UpgradeModal
        open={upgradeOpen}
        dailyLimit={quota?.limit ?? 0}
        plan={quota?.plan ?? "free"}
        onClose={() => setUpgradeOpen(false)}
      />
    </>
  );
}
