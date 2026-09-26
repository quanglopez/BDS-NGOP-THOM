"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/lib/types";

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
      bg.addColorStop(0, "#0B1D3A");
      bg.addColorStop(1, "#132A56");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1080, 1080);

      ctx.fillStyle = "rgba(201,168,106,0.12)";
      ctx.beginPath();
      ctx.arc(950, 80, 320, 0, Math.PI * 2);
      ctx.fill();

      // Header brand
      ctx.fillStyle = "#C9A86A";
      ctx.font = "700 34px Inter, sans-serif";
      ctx.fillText("CHECKBDS.ONLINE • TOÀN QUỐC", 80, 120);

      // Điểm số lớn
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "900 320px Inter, sans-serif";
      ctx.fillText(String(result.overall), 80, 460);
      ctx.font = "700 64px Inter, sans-serif";
      ctx.fillStyle = "#C9A86A";
      ctx.fillText("/100", 80 + ctx.measureText(String(result.overall)).width + 280, 460);

      // Tag kèo
      const tagColor =
        result.tagColor === "green" ? "#059669" : result.tagColor === "yellow" ? "#F59E0B" : "#DC2626";
      ctx.fillStyle = tagColor;
      const tagW = ctx.measureText(result.tag).width + 80;
      roundRect(ctx, 80, 530, tagW, 90, 45);
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "800 44px Inter, sans-serif";
      ctx.fillText(result.tag, 120, 590);

      // Thông tin trích xuất
      ctx.fillStyle = "#E2E8F0";
      ctx.font = "600 40px Inter, sans-serif";
      ctx.fillText(`💰 ${result.extracted.price}   📐 ${result.extracted.area}`, 80, 720);
      ctx.fillText(`📍 ${result.extracted.street}`, 80, 790);

      // Nhận xét 1 dòng
      ctx.fillStyle = "#94A3B8";
      ctx.font = "500 32px Inter, sans-serif";
      wrapText(ctx, result.reasoning, 80, 880, 920, 44);

      // Footer
      ctx.fillStyle = "#C9A86A";
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
        className="h-9 px-4 rounded-full bg-gold text-navy text-[12px] font-bold"
      >
        {busy ? "Đang tạo ảnh..." : "📸 Tạo ảnh đăng Zalo/FB"}
      </button>

      {preview && (
        <div className="mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Ảnh kèo ngon" className="w-[180px] rounded-[10px] border border-slate-200" />
          <div className="mt-1 text-[11px] text-slate-500">Đã tải về máy • 1080x1080</div>
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
