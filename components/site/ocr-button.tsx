"use client";

import { useRef } from "react";

export default function OcrButton({
  onFile,
  disabled,
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="h-[48px] px-5 rounded-[12px] border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-[14px] font-semibold text-slate-700 flex items-center justify-center gap-2 transition"
      >
        <span>🖼</span> Ảnh chụp tin
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
