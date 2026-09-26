"use client";

import type { ReactNode } from "react";
import type { AnalysisResult } from "@/lib/types";
import type { CheckSource } from "@/lib/client-check";
import { ShareImage } from "@/components/site/share-image";

interface Props {
  result: AnalysisResult;
  source: CheckSource;
  analyzedAt?: string;
  onCheckAnother: () => void;
}

// Một ô chỉ số nhỏ trong bảng kết quả
function ScoreCard({
  title,
  badge,
  label,
  detail,
  cardClass = "rounded-[16px] border border-slate-200 p-4",
}: {
  title: string;
  badge: ReactNode;
  label: string;
  detail: string;
  cardClass?: string;
}) {
  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-bold tracking-wide text-slate-500">{title}</div>
        <div className="text-[13px] font-black px-2 py-0.5 rounded-full whitespace-nowrap">{badge}</div>
      </div>
      <div className="mt-2 text-[14px] font-bold text-slate-800">{label}</div>
      <div className="mt-1 text-[12px] text-slate-500 leading-snug">{detail}</div>
    </div>
  );
}

// Thẻ kết quả: vòng điểm tròn, badge nguồn, 6 chỉ số, panel AI phân tích + hành động
export function ResultCard({ result, source, analyzedAt, onCheckAnother }: Props) {
  const t = result;
  const isAi = source === "ai";
  const ringClass =
    t.tagColor === "green"
      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
      : t.tagColor === "yellow"
        ? "border-amber-400 bg-amber-50 text-amber-700"
        : "border-red-400 bg-red-50 text-red-700";
  const tagClass =
    t.tagColor === "green"
      ? "bg-emerald-600 text-white border-emerald-600"
      : t.tagColor === "yellow"
        ? "bg-amber-400 text-amber-950 border-amber-400"
        : "bg-red-600 text-white border-red-600";
  const dotClass =
    t.tagColor === "green" ? "bg-emerald-500" : t.tagColor === "yellow" ? "bg-amber-400" : "bg-red-500";

  const copyAnalysis = () => {
    navigator.clipboard.writeText(`${t.reasoning}\n\n${t.action}`);
  };

  return (
    <div className="bg-white rounded-[24px] border border-slate-200 shadow-[0_24px_70px_-24px_rgba(11,29,58,0.4)] overflow-hidden">
      {/* Đầu thẻ: nền navy + vòng điểm + tag + thông tin trích xuất */}
      <div className="relative px-6 md:px-8 py-6 overflow-hidden bg-gradient-to-br from-navy via-[#132A56] to-navy">
        <div className="absolute -top-20 right-10 w-[280px] h-[280px] bg-gold/15 rounded-full blur-[70px]" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 md:gap-5">
            <div className={`w-[92px] h-[92px] shrink-0 rounded-full flex items-center justify-center border-[6px] relative bg-white ${ringClass}`}>
              <div className="text-center leading-none">
                <div className="text-[30px] font-black tracking-tight">{t.overall}</div>
                <div className="text-[10px] font-bold tracking-widest mt-0.5 opacity-70">/100 ĐIỂM</div>
              </div>
              <svg className="absolute inset-[-6px] w-[92px] h-[92px] -rotate-90" viewBox="0 0 92 92">
                <circle
                  cx="46"
                  cy="46"
                  r="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${(t.overall / 100) * 251} 251`}
                  className="opacity-30"
                />
              </svg>
            </div>

            <div className="min-w-0">
              <div
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                  isAi
                    ? "bg-emerald-400/15 text-emerald-300 border-emerald-400/30"
                    : "bg-amber-400/15 text-amber-300 border-amber-400/30"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isAi ? "bg-emerald-400" : "bg-amber-400"}`} />
                {isAi ? "Phân tích bằng AI" : "Ước tính nhanh – AI đang bận, dùng công thức dự phòng"}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <div
                  className={`inline-flex px-3 py-1 rounded-full text-[11px] font-black tracking-[0.12em] border ${tagClass}`}
                >
                  {t.tag}
                </div>
                <span className="px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-slate-200 text-[11px] font-semibold">💰 {t.extracted.price}</span>
                <span className="px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-slate-200 text-[11px] font-semibold">📐 {t.extracted.area}</span>
                <span className="px-2.5 py-1 rounded-full bg-gold text-navy text-[11px] font-bold">📍 {t.extracted.street}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-right hidden sm:block">
              <div className="text-[10px] tracking-[0.18em] font-bold text-slate-400">THỜI GIAN</div>
              <div className="mt-1 text-[13px] font-semibold text-slate-200">
                {analyzedAt
                  ? `Phân tích lúc ${new Date(analyzedAt).toLocaleTimeString("vi-VN")}`
                  : "Ước tính bằng công thức dự phòng"}
              </div>
            </div>
            <div className={`w-2.5 h-2.5 rounded-full ${dotClass} animate-pulse`} />
          </div>
        </div>
      </div>

      {/* Thân thẻ: 6 chỉ số + 2 panel */}
      <div className="p-6 md:p-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ScoreCard
            title="💰 NGỘP BANK"
            badge={
              <span
                className={
                  t.breakdown.ngop.score > 70
                    ? "bg-emerald-600 text-white"
                    : t.breakdown.ngop.score > 40
                      ? "bg-amber-400 text-amber-950"
                      : "bg-slate-200 text-slate-600"
                }
              >
                {t.breakdown.ngop.score}%
              </span>
            }
            label={t.breakdown.ngop.label}
            detail={t.breakdown.ngop.detail}
            cardClass="rounded-[16px] border border-slate-200 p-4 bg-[#FFFEFB]"
          />
          <ScoreCard
            title="📈 TIỀM NĂNG TĂNG GIÁ"
            badge={<span className="bg-navy text-white">{t.breakdown.tangGia.score}/100</span>}
            label={t.breakdown.tangGia.label}
            detail={t.breakdown.tangGia.detail}
          />
          <ScoreCard
            title="💧 THANH KHOẢN"
            badge={<span className="bg-slate-800 text-white">{t.breakdown.thanhKhoan.score}/100</span>}
            label={t.breakdown.thanhKhoan.label}
            detail={t.breakdown.thanhKhoan.detail}
          />
          <ScoreCard
            title="📄 PHÁP LÝ"
            badge={
              <span
                className={
                  t.breakdown.phapLy.score > 80 ? "bg-emerald-600 text-white" : "bg-amber-400 text-amber-950"
                }
              >
                {t.breakdown.phapLy.score}% an toàn
              </span>
            }
            label={t.breakdown.phapLy.label}
            detail={t.breakdown.phapLy.detail}
          />
          <ScoreCard
            title="💵 SO VỚI THỊ TRƯỜNG"
            badge={
              <span
                className={
                  t.breakdown.giaThiTruong.diffPercent > 0 ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
                }
              >
                {t.breakdown.giaThiTruong.label}
              </span>
            }
            label={`${t.breakdown.giaThiTruong.diffAmount}${
              t.breakdown.giaThiTruong.diffPercent > 0
                ? ` (~${Math.abs(t.breakdown.giaThiTruong.diffPercent) > 10 ? "1 tỷ" : "600tr"})`
                : ""
            }`}
            detail={t.breakdown.giaThiTruong.detail}
            cardClass={`rounded-[16px] border p-4 ${
              t.breakdown.giaThiTruong.diffPercent > 0
                ? "border-emerald-200 bg-emerald-50/60"
                : "border-red-200 bg-red-50/60"
            }`}
          />
          <ScoreCard
            title="📍 VỊ TRÍ"
            badge={<span className="bg-gold text-navy">{t.breakdown.viTri.score}/100</span>}
            label={t.breakdown.viTri.label}
            detail={t.breakdown.viTri.detail}
            cardClass="rounded-[16px] border border-slate-200 p-4 bg-cream"
          />
        </div>

        <div className="mt-6 grid md:grid-cols-[1.2fr_0.8fr] gap-6">
          <div className="rounded-[16px] bg-navy text-slate-200 p-5 md:p-6">
            <div className="text-[11px] font-bold tracking-[0.14em] text-gold">AI PHÂN TÍCH</div>
            <p className="mt-3 text-[14px] leading-[1.7] text-slate-100">{t.reasoning}</p>
          </div>

          <div
            className={`rounded-[16px] p-5 md:p-6 border-2 ${
              t.actionType === "hot"
                ? "bg-emerald-50 border-emerald-200"
                : t.actionType === "ok"
                  ? "bg-amber-50 border-amber-200"
                  : "bg-red-50 border-red-200"
            }`}
          >
            <div
              className={`text-[11px] font-bold tracking-[0.14em] ${
                t.actionType === "hot"
                  ? "text-emerald-700"
                  : t.actionType === "ok"
                    ? "text-amber-700"
                    : "text-red-700"
              }`}
            >
              HÀNH ĐỘNG ĐỀ XUẤT
            </div>
            <p className="mt-3 text-[14px] leading-[1.6] font-semibold text-slate-800">{t.action}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onCheckAnother}
                className="h-9 px-4 rounded-full bg-navy text-white text-[12px] font-bold"
              >
                Check tin khác
              </button>
              <button
                type="button"
                onClick={copyAnalysis}
                className="h-9 px-4 rounded-full bg-white border border-slate-200 text-[12px] font-bold text-slate-700"
              >
                Copy phân tích
              </button>
            </div>
            <div className="mt-3">
              <ShareImage result={t} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
