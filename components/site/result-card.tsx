"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Droplets, FileText, Lock, MapPin, Ruler, Scale, TrendingUp, Wallet } from "lucide-react";
import type { AnalysisResult } from "@/lib/types";
import type { CheckSource } from "@/lib/client-check";
import { savePendingReport } from "@/lib/pending-report";
import { scoreContributions } from "@/lib/score-explain";
import { trackEvent } from "@/lib/analytics";
import { ShareImage } from "@/components/site/share-image";
import { ScoreRing } from "@/components/site/score-ring";
import { reportUrl } from "@/lib/report/slug";

interface Props {
  result: AnalysisResult;
  source: CheckSource;
  analyzedAt?: string;
  authRequired?: boolean;
  // Dữ liệu gốc để lưu pending-report trước khi đá sang login
  pendingText?: string;
  pendingListingUrl?: string | null;
  // Plan-aware: Pro thấy CTA mở report chuyên sâu; Free thấy CTA mở khóa
  isPro?: boolean;
  checkId?: string | null;
  // Slug SEO để dựng link /bao-cao/{slug}; null thì reportUrl rơi về UUID.
  seoSlug?: string | null;
  onCheckAnother: () => void;
}

// Một ô chỉ số nhỏ trong bảng kết quả.
// `title` nhận ReactNode để chứa icon + nhãn thay vì emoji nhúng trong chuỗi.
function ScoreCard({
  title,
  badge,
  label,
  detail,
  cardClass = "rounded-lg border border-line bg-white p-4",
}: {
  title: ReactNode;
  badge: ReactNode;
  label: string;
  detail: string;
  cardClass?: string;
}) {
  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-micro font-semibold text-ink-600">{title}</div>
        <div className="whitespace-nowrap rounded-pill px-2 py-0.5 text-small font-bold">{badge}</div>
      </div>
      <div className="mt-2 text-small font-bold text-ink-900">{label}</div>
      <div className="mt-1 text-micro leading-snug text-ink-600">{detail}</div>
    </div>
  );
}

// Thẻ kết quả: vòng điểm luôn hiện. Khách chưa login thấy 2 dòng lý do đầu,
// 4 panel chi tiết bị blur + lock + CTA mở khóa (không chặn trước khi check).
export function ResultCard({
  result,
  source,
  analyzedAt,
  authRequired,
  pendingText,
  pendingListingUrl,
  isPro = false,
  checkId = null,
  seoSlug = null,
  onCheckAnother,
}: Props) {
  const t = result;
  const isAi = source === "ai";
  const tagClass =
    t.tagColor === "green"
      ? "bg-ai-ink text-white border-ai-ink"
      : t.tagColor === "yellow"
        ? "bg-risk-medium text-white border-risk-medium"
        : "bg-risk-high text-white border-risk-high";
  const dotClass =
    t.tagColor === "green" ? "bg-ai-ink" : t.tagColor === "yellow" ? "bg-risk-medium" : "bg-risk-high";

  const contributions = scoreContributions(t);
  // Khách chưa login: cho thấy vòng điểm + 2 lý do đầu, khóa 4 panel chi tiết
  const visibleContribs = authRequired ? contributions.slice(0, 2) : contributions;

  const copyAnalysis = () => {
    navigator.clipboard.writeText(`${t.reasoning}\n\n${t.action}`);
  };

  // Bấm mở khóa: lưu report đang xem để sau login quay lại đúng chỗ, không nhập lại
  const unlockHref = (() => {
    if (typeof window === "undefined") return "/login";
    const next = `${window.location.pathname}${window.location.search}#kiem-tra`;
    return `/login?next=${encodeURIComponent(next)}`;
  })();

  const handleUnlock = () => {
    trackEvent("login_clicked", { from: "report_lock" });
    savePendingReport({
      text: pendingText ?? "",
      listingUrl: pendingListingUrl ?? null,
      returnTo: typeof window !== "undefined" ? `${window.location.pathname}#kiem-tra` : "/#kiem-tra",
    });
  };

  return (
    <div className="overflow-hidden rounded-panel border border-line bg-white shadow-navy">
      {/* Đầu thẻ: nền navy + vòng điểm + tag + thông tin trích xuất */}
      <div className="relative overflow-hidden bg-gradient-to-br from-navy-800 via-navy-700 to-navy-900 px-6 py-6 md:px-8">
        <div className="absolute -top-20 right-10 h-[280px] w-[280px] rounded-full bg-gold-base/10 blur-[70px]" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 md:gap-5">
            <ScoreRing score={t.overall} tone={t.tagColor} caption="/100 ĐIỂM" />

            <div className="min-w-0">
              <div
                className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-micro font-bold ${
                  isAi
                    ? "border-ai/30 bg-ai/15 text-ai/90"
                    : "border-white/20 bg-white/10 text-ink-on-navy"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${isAi ? "bg-ai" : "bg-ink-on-navy-muted"}`}
                />
                {isAi ? "Phân tích bằng AI" : "Phân tích theo mô hình CheckBDS"}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <div
                  className={`inline-flex rounded-pill border px-3 py-1 text-micro font-bold tracking-[0.09em] ${tagClass}`}
                >
                  {t.tag}
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-pill border border-white/15 bg-white/10 px-2.5 py-1 text-micro font-semibold text-ink-on-navy">
                  <Wallet size={13} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                  {t.extracted.price}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-pill border border-white/15 bg-white/10 px-2.5 py-1 text-micro font-semibold text-ink-on-navy">
                  <Ruler size={13} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                  {t.extracted.area}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-gold-base px-2.5 py-1 text-micro font-bold text-navy-900">
                  <MapPin size={13} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                  {t.extracted.street}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden text-right sm:block">
              <div className="text-micro font-bold tracking-[0.09em] text-ink-on-navy-faint">
                THỜI GIAN
              </div>
              <div className="mt-1 text-small font-semibold text-ink-on-navy">
                {analyzedAt ? `Phân tích lúc ${new Date(analyzedAt).toLocaleTimeString("vi-VN")}` : "Vừa xong"}
              </div>
            </div>
            <div aria-hidden="true" className={`h-2.5 w-2.5 animate-pulse rounded-full ${dotClass}`} />
          </div>
        </div>
      </div>

      {/* Chưa đăng nhập: kết quả là bản xem trước -> CTA mở khóa ngay sau aha moment */}
      {authRequired && (
        <div className="border-b border-line bg-gradient-to-r from-gold-base/10 to-white px-6 py-5 md:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1">
              <div className="text-body font-display font-bold text-ink-900">
                Bạn đang xem bản xem trước. Đăng nhập miễn phí để xem đầy đủ.
              </div>
              <div className="mt-1 text-micro text-ink-600">
                Mở khóa 4 panel chi tiết + 20 tin/ngày • Không cần thẻ • Google trong 10 giây
              </div>
            </div>
            <Link
              href={unlockHref}
              onClick={handleUnlock}
              className="flex h-[46px] shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-gold-base px-6 text-small font-bold text-navy-900 transition-colors duration-micro ease-cb hover:bg-gold-soft"
            >
              Mở khóa báo cáo →
            </Link>
          </div>
        </div>
      )}

      {/* Thân thẻ: giải thích điểm + 6 chỉ số + 2 panel */}
      <div className="p-6 md:p-8">
        {/* Tại sao được điểm đó — khách chưa login chỉ thấy 2 lý do đầu */}
        <div className="relative overflow-hidden rounded-lg border border-line bg-surface-mist p-4 md:p-5">
          <div className="text-small font-display font-bold text-ink-900">
            Tại sao tin này được {t.overall} điểm?
          </div>
          <div className="mt-3 space-y-2">
            {visibleContribs.map((c) => (
              <div key={c.label} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 w-[52px] shrink-0 text-right text-small font-bold tabular-nums ${
                    c.kind === "plus" ? "text-ai-ink" : c.kind === "minus" ? "text-risk-high" : "text-ink-500"
                  }`}
                >
                  {c.delta > 0 ? `+${c.delta}` : c.delta < 0 ? `${c.delta}` : "±0"}
                </span>
                <div className="min-w-0">
                  <div className="text-small font-bold text-ink-900">{c.label}</div>
                  <div className="text-micro leading-snug text-ink-600">{c.note}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-line pt-3 text-micro text-ink-500">
            Điểm khởi đầu 50 • Cộng/trừ theo trọng số của mô hình chấm điểm CheckBDS
          </div>

          {/* 4 panel bị khóa: blur + overlay CTA */}
          {authRequired && (
            <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-white via-white/85 to-transparent px-4 pb-5 pt-24">
              <Link
                href={unlockHref}
                onClick={handleUnlock}
                className="flex h-[46px] items-center justify-center rounded-md bg-navy-900 px-6 text-small font-bold text-white shadow-lift transition-colors duration-micro ease-cb hover:bg-navy-800"
              >
                Đăng nhập miễn phí để xem đầy đủ
              </Link>
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <ScoreCard
            title={
              <>
                <Wallet size={14} strokeWidth={1.75} aria-hidden="true" />
                NGỘP BANK
              </>
            }
            badge={
              <span
                className={
                  authRequired
                    ? "bg-surface-mist text-ink-500"
                    : t.breakdown.ngop.score > 70
                      ? "bg-ai-ink text-white"
                      : t.breakdown.ngop.score > 40
                        ? "bg-risk-medium text-white"
                        : "bg-surface-mist text-ink-600"
                }
              >
                {authRequired ? <Lock size={13} strokeWidth={1.75} aria-hidden="true" /> : `${t.breakdown.ngop.score}%`}
              </span>
            }
            label={authRequired ? "Đăng nhập để xem" : t.breakdown.ngop.label}
            detail={authRequired ? "Mở khóa để xem chi tiết dấu hiệu bán gấp." : t.breakdown.ngop.detail}
            cardClass="rounded-lg border border-line bg-surface-mist p-4"
          />
          <ScoreCard
            title={
              <>
                <TrendingUp size={14} strokeWidth={1.75} aria-hidden="true" />
                TIỀM NĂNG TĂNG GIÁ
              </>
            }
            badge={
              <span className={authRequired ? "bg-surface-mist text-ink-500" : "bg-navy-900 text-white"}>
                {authRequired ? <Lock size={13} strokeWidth={1.75} aria-hidden="true" /> : `${t.breakdown.tangGia.score}/100`}
              </span>
            }
            label={authRequired ? "Đăng nhập để xem" : t.breakdown.tangGia.label}
            detail={authRequired ? "Mở khóa để xem phân tích khu vực." : t.breakdown.tangGia.detail}
          />
          <ScoreCard
            title={
              <>
                <Droplets size={14} strokeWidth={1.75} aria-hidden="true" />
                THANH KHOẢN
              </>
            }
            badge={
              <span className={authRequired ? "bg-surface-mist text-ink-500" : "bg-ink-900 text-white"}>
                {authRequired ? <Lock size={13} strokeWidth={1.75} aria-hidden="true" /> : `${t.breakdown.thanhKhoan.score}/100`}
              </span>
            }
            label={authRequired ? "Đăng nhập để xem" : t.breakdown.thanhKhoan.label}
            detail={authRequired ? "Mở khóa để xem đánh giá thanh khoản." : t.breakdown.thanhKhoan.detail}
          />
          <ScoreCard
            title={
              <>
                <FileText size={14} strokeWidth={1.75} aria-hidden="true" />
                PHÁP LÝ
              </>
            }
            badge={
              <span
                className={
                  authRequired
                    ? "bg-surface-mist text-ink-500"
                    : t.breakdown.phapLy.score > 80
                      ? "bg-ai-ink text-white"
                      : "bg-risk-medium text-white"
                }
              >
                {authRequired ? <Lock size={13} strokeWidth={1.75} aria-hidden="true" /> : `${t.breakdown.phapLy.score}/100 pháp lý`}
              </span>
            }
            label={authRequired ? "Đăng nhập để xem" : t.breakdown.phapLy.label}
            detail={authRequired ? "Mở khóa để xem phân tích pháp lý." : t.breakdown.phapLy.detail}
          />
          <ScoreCard
            title={
              <>
                <Scale size={14} strokeWidth={1.75} aria-hidden="true" />
                SO VỚI THỊ TRƯỜNG
              </>
            }
            badge={
              <span
                className={
                  authRequired
                    ? "bg-surface-mist text-ink-500"
                    : t.breakdown.giaThiTruong.diffPercent > 0
                      ? "bg-ai-ink text-white"
                      : "bg-risk-high text-white"
                }
              >
                {authRequired ? <Lock size={13} strokeWidth={1.75} aria-hidden="true" /> : t.breakdown.giaThiTruong.label}
              </span>
            }
            label={authRequired ? "Đăng nhập để xem" : `${t.breakdown.giaThiTruong.diffAmount}`}
            detail={authRequired ? "Mở khóa để xem so sánh giá." : t.breakdown.giaThiTruong.detail}
            cardClass={`rounded-lg border p-4 ${
              authRequired
                ? "border-line bg-surface-mist"
                : t.breakdown.giaThiTruong.diffPercent > 0
                  ? "border-ai/30 bg-ai-wash"
                  : "border-risk-high/30 bg-risk-high-wash"
            }`}
          />
          <ScoreCard
            title={
              <>
                <MapPin size={14} strokeWidth={1.75} aria-hidden="true" />
                VỊ TRÍ
              </>
            }
            badge={
              <span className={authRequired ? "bg-surface-mist text-ink-500" : "bg-gold-base text-navy-900"}>
                {authRequired ? <Lock size={13} strokeWidth={1.75} aria-hidden="true" /> : `${t.breakdown.viTri.score}/100`}
              </span>
            }
            label={authRequired ? "Đăng nhập để xem" : t.breakdown.viTri.label}
            detail={authRequired ? "Mở khóa để xem đánh giá vị trí." : t.breakdown.viTri.detail}
            cardClass="rounded-lg border border-line bg-surface-mist p-4"
          />
        </div>

        <div className="relative mt-6 grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          {authRequired && (
            <Link
              href={unlockHref}
              onClick={handleUnlock}
              aria-label="Đăng nhập miễn phí để xem đầy đủ"
              className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/60 backdrop-blur-[2px]"
            >
              <span className="flex h-[46px] items-center rounded-md bg-navy-900 px-6 text-small font-bold text-white shadow-lift">
                Mở khóa báo cáo
              </span>
            </Link>
          )}
          <div className="rounded-lg bg-navy-900 p-5 text-ink-on-navy md:p-6" aria-hidden={authRequired}>
            <div className="text-micro font-bold tracking-[0.09em] text-gold-base">NHẬN XÉT</div>
            <p className="mt-3 text-body leading-[1.7] text-ink-on-navy">{t.reasoning}</p>
          </div>

          <div
            className={`rounded-lg border-2 p-5 md:p-6 ${
              t.actionType === "hot"
                ? "border-ai/30 bg-ai-wash"
                : t.actionType === "ok"
                  ? "border-risk-medium/30 bg-risk-medium-wash"
                  : "border-risk-high/30 bg-risk-high-wash"
            }`}
            aria-hidden={authRequired}
          >
            <div
              className={`text-micro font-bold tracking-[0.09em] ${
                t.actionType === "hot"
                  ? "text-ai-ink"
                  : t.actionType === "ok"
                    ? "text-risk-medium"
                    : "text-risk-high"
              }`}
            >
              HÀNH ĐỘNG ĐỀ XUẤT
            </div>
            <p className="mt-3 text-body font-semibold leading-[1.6] text-ink-900">{t.action}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onCheckAnother}
                tabIndex={authRequired ? -1 : 0}
                className="h-12 rounded-pill bg-navy-900 px-4 text-small font-bold text-white transition-colors duration-micro ease-cb hover:bg-navy-800"
              >
                Check tin khác
              </button>
              <button
                type="button"
                onClick={copyAnalysis}
                tabIndex={authRequired ? -1 : 0}
                className="h-12 rounded-pill border border-line bg-white px-4 text-small font-bold text-ink-700 transition-colors duration-micro ease-cb hover:bg-surface-mist"
              >
                Copy phân tích
              </button>
            </div>
            <div className="mt-3">
              <ShareImage result={t} />
            </div>
            {/* Plan-aware: Pro mở report chuyên sâu; Free (đã login, có checkId) thấy CTA mở khóa */}
            {checkId && !authRequired && (
              <div className="mt-4">
                {isPro ? (
                  <Link
                    href={reportUrl(checkId, seoSlug)}
                    className="flex h-12 w-full items-center justify-center rounded-md bg-navy-900 text-small font-bold text-white transition-colors duration-micro ease-cb hover:bg-navy-800"
                  >
                    Xem phân tích chuyên sâu →
                  </Link>
                ) : (
                  <Link
                    href={reportUrl(checkId, seoSlug)}
                    onClick={() => {
                      trackEvent("pro_unlock_click", { checkId });
                      trackEvent("upgrade_from_report_click", { checkId });
                    }}
                    className="block rounded-md border-2 border-dashed border-gold-base/70 bg-gold-base/10 px-4 py-3 text-center transition-colors duration-micro ease-cb hover:border-gold-base"
                  >
                    <span className="flex items-center justify-center gap-1.5 text-small font-bold text-ink-900">
                      <Lock size={14} strokeWidth={1.75} aria-hidden="true" />
                      MỞ KHÓA PHÂN TÍCH PRO
                    </span>
                    <span className="mt-0.5 block text-micro text-ink-600">
                      Không chỉ xem điểm số — hiểu vì sao bất động sản được chấm như vậy.
                    </span>
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
