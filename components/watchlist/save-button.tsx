"use client";

import { useState } from "react";
import { Link2, Loader2, Star } from "lucide-react";
import { postWatchlistCheck } from "@/lib/watchlist/client";
import { labelOf } from "@/lib/watchlist/row-view";
import type { WatchlistStatus } from "@/lib/watchlist/types";

export interface WatchlistSaveButtonProps {
  checkId: string;
  /** Đã lưu từ trước (server đọc DB) -> hiện trạng thái "Đã lưu". */
  initiallySaved?: boolean;
  /** Trạng thái hiện tại nếu đã lưu — để hiển thị nhãn đúng. */
  initialStatus?: WatchlistStatus;
}

/**
 * Nút lưu 1 tin đã kiểm tra vào Theo dõi. Không tốn lượt kiểm tra, không gọi
 * AI. Bấm lại khi đã lưu chỉ báo "Đã lưu", không nhân đôi (backend idempotent).
 */
export function WatchlistSaveButton({
  checkId,
  initiallySaved = false,
  initialStatus = "moi_luu",
}: WatchlistSaveButtonProps) {
  const [saved, setSaved] = useState(initiallySaved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await postWatchlistCheck(checkId, { status: "moi_luu" });
    setBusy(false);
    if (!res.ok) {
      setError(
        res.status === 401
          ? "Phiên đăng nhập hết hạn. Đăng nhập lại rồi bấm lưu."
          : res.status === 404
            ? "Không tìm thấy tin đã kiểm tra này."
            : res.message,
      );
      return;
    }
    setSaved(true);
  }

  if (saved) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-risk-clear/40 bg-risk-clear-wash px-3 text-[13px] font-bold text-risk-clear">
          <Star className="h-4 w-4" aria-hidden />
          ★ Đã lưu vào Theo dõi
          {initialStatus !== "moi_luu" ? ` • ${labelOf(initialStatus)}` : ""}
        </span>
        <a
          href="/watchlist"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-[13px] font-semibold text-navy hover:underline"
        >
          <Link2 className="h-4 w-4" aria-hidden />
          Mở Theo dõi
        </a>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-[13px] font-bold text-navy hover:bg-slate-50 disabled:opacity-60"
        onClick={() => void save()}
        disabled={busy}
        aria-label="Lưu tin này vào Theo dõi"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Star className="h-4 w-4" aria-hidden />
        )}
        ☆ Lưu theo dõi
      </button>
      <span className="text-[11px] text-slate-500">0 lượt kiểm tra</span>
      {error && (
        <span role="alert" className="text-[12px] text-risk-high">
          {error}
        </span>
      )}
    </div>
  );
}
