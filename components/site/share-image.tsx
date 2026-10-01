"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import type { AnalysisResult } from "@/lib/types";

/**
 * Bảng màu cho Canvas — PHẢI là hằng số, không đọc được CSS variable.
 *
 * Canvas API chỉ nhận chuỗi màu nên không dùng được token Tailwind/`.cb-*`.
 * Các giá trị dưới đây KHÔNG phải bảng màu mới: chúng là bản sao của token đã
 * có trong `tailwind.config.ts`, giữ đúng vai trò sử dụng:
 *   navy.DEFAULT #0B1D3A → nền
 *   navy.700      #12305F → gradient nền
 *   gold.base     #D8B46A → nhấn / brand
 *   risk.clear    #047857 → tag xanh
 *   risk.medium   #B54708 → tag vàng  (thay #F59E0B: chữ trắng trên #F59E0B
 *                                  chỉ đạt ~2.1:1, trượt WCAG AA)
 *   risk.high     #B42318 → tag đỏ
 *   ink.on-navy-muted  #A9BBD4 → dữ liệu trích xuất
 *   ink.on-navy-faint  #7E94B4 → nhận xét
 */
const C = {
  navyBase: "#0B1D3A",
  navy700: "#12305F",
  gold: "#D8B46A",
  goldWash: "rgba(216, 180, 106, 0.12)",
  white: "#FFFFFF",
  tagGreen: "#047857",
  tagYellow: "#B54708",
  tagRed: "#B42318",
  onNavyMuted: "#A9BBD4",
  onNavyFaint: "#7E94B4",
} as const;

/** Vẽ marker thay emoji: Canvas không render emoji ổn định giữa các OS. */
type Marker = "coin" | "plot" | "pin";

/** Trả về toạ độ X bắt đầu để vẽ chữ ngay sau marker. */
function drawMarker(ctx: CanvasRenderingContext2D, kind: Marker, x: number, cy: number): number {
  const w = 30;
  ctx.beginPath();
  if (kind === "coin") {
    ctx.arc(x + w / 2, cy, 15, 0, Math.PI * 2);
  } else if (kind === "plot") {
    ctx.rect(x, cy - 14, 30, 28);
  } else {
    // Ghim: vòng tròn + nón nhọn
    ctx.arc(x + 15, cy - 6, 12, Math.PI, 0);
    ctx.lineTo(x + 15, cy + 16);
    ctx.closePath();
  }
  ctx.fill();
  return x + w;
}

// Tạo ảnh 1080x1080 "KÈO NGỘP NGON 88/100" để đăng Zalo/FB (Canvas API, thuần client)
export function ShareImage({ result }: { result: AnalysisResult }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const render = async () => {
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1080;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Nền navy + khối gold
      const bg = ctx.createLinearGradient(0, 0, 1080, 1080);
      bg.addColorStop(0, C.navyBase);
      bg.addColorStop(1, C.navy700);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1080, 1080);

      ctx.fillStyle = C.goldWash;
      ctx.beginPath();
      ctx.arc(950, 80, 320, 0, Math.PI * 2);
      ctx.fill();

      // Header brand
      ctx.fillStyle = C.gold;
      ctx.font = "700 34px Inter, sans-serif";
      ctx.fillText("CHECKBDS.ONLINE • TOÀN QUỐC", 80, 120);

      // Điểm số lớn
      ctx.fillStyle = C.white;
      ctx.font = "900 320px Inter, sans-serif";
      ctx.fillText(String(result.overall), 80, 460);
      ctx.font = "700 64px Inter, sans-serif";
      ctx.fillStyle = C.gold;
      ctx.fillText("/100", 80 + ctx.measureText(String(result.overall)).width + 280, 460);

      // Tag kèo
      const tagColor =
        result.tagColor === "green" ? C.tagGreen : result.tagColor === "yellow" ? C.tagYellow : C.tagRed;
      ctx.fillStyle = tagColor;
      const tagW = ctx.measureText(result.tag).width + 80;
      roundRect(ctx, 80, 530, tagW, 90, 45);
      ctx.fill();
      ctx.fillStyle = C.white;
      ctx.font = "800 44px Inter, sans-serif";
      ctx.fillText(result.tag, 120, 590);

      // Thông tin trích xuất — marker vẽ tay thay 3 emoji cũ (tiền / diện tích / địa chỉ)
      ctx.fillStyle = C.gold;
      let x = drawMarker(ctx, "coin", 80, 706) + 20;
      ctx.fillStyle = C.onNavyMuted;
      ctx.font = "600 40px Inter, sans-serif";
      ctx.fillText(result.extracted.price, x, 720);
      ctx.fillStyle = C.gold;
      x = drawMarker(ctx, "plot", x + ctx.measureText(result.extracted.price).width + 60, 706) + 20;
      ctx.fillStyle = C.onNavyMuted;
      ctx.fillText(result.extracted.area, x, 720);
      ctx.fillStyle = C.gold;
      drawMarker(ctx, "pin", 80, 776);
      ctx.fillStyle = C.onNavyMuted;
      ctx.fillText(result.extracted.street, 130, 790);

      // Nhận xét 1 dòng
      ctx.fillStyle = C.onNavyFaint;
      ctx.font = "500 32px Inter, sans-serif";
      wrapText(ctx, result.reasoning, 80, 880, 920, 44);

      // Footer
      ctx.fillStyle = C.gold;
      ctx.font = "700 30px Inter, sans-serif";
      ctx.fillText("checkbds.online • AI chấm điểm BĐS Việt Nam", 80, 1030);

      const url = canvas.toDataURL("image/png");
      setPreview(url);

      // Tải về máy
      const a = document.createElement("a");
      a.href = url;
      a.download = `keo-ngop-${result.overall}-100.png`;
      a.click();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={render}
        disabled={busy}
        className="flex h-9 items-center gap-1.5 rounded-pill bg-gold-base px-4 text-micro font-bold text-navy-900"
      >
        <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {busy ? "Đang tạo ảnh..." : "Tạo ảnh đăng Zalo/FB"}
      </button>

      {preview && (
        <div className="mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Ảnh kèo ngon" className="w-[180px] rounded-sm border border-line" />
          <div className="mt-1 text-micro text-slate-500">Đã tải về máy • 1080x1080</div>
        </div>
      )}
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(" ");
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = w;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y);
}
