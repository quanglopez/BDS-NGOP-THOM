"use client";

import type { ReactNode } from "react";
import type { AnalysisResult } from "@/lib/types";

interface Props {
  result: AnalysisResult;
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

// Thẻ kết quả: vòng điểm tròn, 6 chỉ số, panel AI phân tích + hành động
export function ResultCard({ result, onCheckAnother }: Props) {
  const t = result;
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
    <div className="bg-white rounded-[24px] border border-slate-200 shadow-[0_20px_60px_-24px_rgba(0,0,0,0.25)] overflow-hidden">
      {/* Đầu thẻ: vòng điểm + tag + thông tin trích xuất */}
      <div className="px-6 md:px-8 py-5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-white to-[#FFFEFB]">
        <div className="flex items-center gap-4">
          <div className={`w-[88px] h-[88px] rounded-full flex items-center justify-center border-[6px] relative ${ringClass}`}>
            <div className="text-center leading-none">
              <div className="text-[28px] font-black tracking-tight">{t.overall}</div>
              <div className="text-[11px] font-bold tracking-widest mt-0.5">/100</div>
            </div>
            <svg className="absolute inset-[-6px] w-[88px] h-[88px] -rotate-90" viewBox="0 0 88 88">
              <circle
                cx="44"
                cy="44"
                r="38"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${(t.overall / 100) * 238} 238`}
                className="opacity-30"
              />
            </svg>
          </div>

          <div>
            <div className={`inline-flex px-3 py-1 rounded-full text-[11px] font-black tracking-[0.12em] border ${tagClass}`}>
              {t.tag}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
              <span className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200">💰 {t.extracted.price}</span>
              <span className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200">📐 {t.extracted.area}</span>
              <span className="px-2.5 py-1 rounded-full bg-navy text-white">📍 {t.extracted.street}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-right hidden sm:block">
            <div className="text-[11px] tracking-widest font-bold text-slate-400">AI SCORE</div>
            <div className="text-[13px] font-semibold text-slate-700">
              Cập nhật {new Date().toLocaleTimeString("vi-VN")}
            </div>
          </div>
          <div className={`w-3 h-3 rounded-full ${dotClass} animate-pulse`} />
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
            <div className="mt-4 flex gap-2">
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
          </div>
        </div>
      </div>
    </div>
  );
}
