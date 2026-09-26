"use client";

import { useRef } from "react";

export default function OcrButton({
  onFile,
  disabled,
  compact = false,
  label = "Ảnh chụp tin",
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={
          compact
            ? "h-9 px-4 rounded-[10px] bg-navy text-white hover:bg-[#112a5a] disabled:opacity-50 text-[12px] font-bold flex items-center justify-center gap-1.5 transition"
            : "h-[50px] px-5 rounded-[12px] border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 text-[14px] font-semibold text-slate-700 flex items-center justify-center gap-2 transition"
        }
      >
        <span>🖼</span> {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </>
  );
}
