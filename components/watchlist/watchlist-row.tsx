"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, MoreHorizontal, StickyNote, Trash2 } from "lucide-react";
import { fmtArea, fmtVnd } from "@/lib/price/format";
import { WATCHLIST_NOTE_MAX } from "@/lib/watchlist/types";
import { deleteWatchlist, formatViDate, patchWatchlist } from "@/lib/watchlist/client";
import { labelOf, type WatchlistRowView } from "@/lib/watchlist/row-view";
import { Button } from "@/components/ui/button";

const STATUS_OPTIONS: WatchlistRowView["status"][] = [
  "moi_luu",
  "can_goi",
  "da_goi",
  "dang_theo",
  "bo_qua",
];

const STATUS_STYLE: Record<WatchlistRowView["status"], string> = {
  moi_luu: "border-line bg-slate-100 text-slate-700",
  can_goi: "border-risk-medium/40 bg-risk-medium-wash text-risk-medium",
  da_goi: "border-risk-clear/40 bg-risk-clear-wash text-risk-clear",
  dang_theo: "border-ai/40 bg-ai-wash text-ai-ink",
  bo_qua: "border-line bg-surface text-ink-500",
};

export interface WatchlistRowProps {
  row: WatchlistRowView;
  /** Cập nhật row trong state của list (optimistic + server). */
  onChange: (id: string, next: WatchlistRowView) => void;
  /** Xoá khỏi list sau khi DELETE thành công. */
  onRemove: (id: string) => void;
}

/**
 * Một dòng watchlist. Optimistic + rollback luôn cập nhật LÊN LIST qua
 * onChange, không giữ state row riêng — nguồn duy nhất là list state.
 * Sort chạy ở list; đổi status KHÔNG re-sort ngay.
 */
export function WatchlistRow({ row, onChange, onRemove }: WatchlistRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState(row.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (editing) noteRef.current?.focus();
  }, [editing]);

  // Row mới từ server -> sync bản nháp trừ khi đang soạn (không ghi đè bản nháp).
  useEffect(() => {
    if (!editing) setNoteDraft(row.note ?? "");
  }, [editing, row.note]);

  async function changeStatus(next: WatchlistRowView["status"]) {
    if (busy || next === row.status) return;
    setBusy(true);
    setError(null);
    // Optimistic: đổi ngay, rollback về row cũ nếu fail.
    onChange(row.id, { ...row, status: next, statusLabel: labelOf(next) });
    const res = await patchWatchlist(row.id, { status: next });
    setBusy(false);
    setMenuOpen(false);
    if (!res.ok) {
      onChange(row.id, row);
      setError({ status: res.status, message: res.message });
      return;
    }
  }

  async function saveNote() {
    const draft = noteDraft.trim();
    if (draft.length > WATCHLIST_NOTE_MAX) {
      setError({ status: 0, message: `Ghi chú tối đa ${WATCHLIST_NOTE_MAX} ký tự.` });
      return;
    }
    setBusy(true);
    setError(null);
    onChange(row.id, { ...row, note: draft.length ? draft : null });
    const res = await patchWatchlist(row.id, { note: draft.length ? draft : null });
    setBusy(false);
    if (!res.ok) {
      onChange(row.id, row);
      setError({ status: res.status, message: res.message });
      return;
    }
    setEditing(false);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    // Bi quan: chỉ mất khỏi list khi DELETE THÀNH CÔNG.
    const res = await deleteWatchlist(row.id);
    setBusy(false);
    setConfirming(false);
    setMenuOpen(false);
    if (!res.ok) {
      setError({ status: res.status, message: res.message });
      return;
    }
    onRemove(row.id);
  }

  const meta = [
    row.priceVnd !== null ? fmtVnd(row.priceVnd) : null,
    row.sizeM2 !== null ? `${fmtArea(row.sizeM2)} m²` : null,
    row.areaName || row.province,
    row.regionName,
  ]
    .filter(Boolean)
    .join(" • ");

  return (
    <li data-watchlist-row={row.id} className="rounded-lg border border-line bg-surface p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-h3 text-navy" title={row.title}>
            {row.reportUrl ? (
              <a href={row.reportUrl} className="hover:underline">
                {row.title}
              </a>
            ) : (
              row.title
            )}
          </h3>
          {meta && <p className="mt-1 text-small text-ink-600">{meta}</p>}
          <p className="mt-1 text-micro text-ink-500">
            Cập nhật: {formatViDate(row.updatedAt)}
          </p>
        </div>

        <div className="relative shrink-0" ref={menuRef}>
          <Button
            type="button"
            variant="outline"
            className="h-12 w-12 p-0"
            aria-label="Thao tác mục đã lưu"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={busy}
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden />
          </Button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute top-[52px] right-0 z-10 w-56 rounded-md border border-line bg-surface p-1 shadow-lift"
            >
              <button
                type="button"
                role="menuitem"
                className="flex h-12 w-full items-center gap-2 rounded px-3 text-left text-small text-navy hover:bg-surface-mist"
                onClick={() => {
                  setEditing(true);
                  setMenuOpen(false);
                }}
              >
                <StickyNote className="h-4 w-4" aria-hidden />
                {row.note ? "Sửa ghi chú" : "Thêm ghi chú"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex h-12 w-full items-center gap-2 rounded px-3 text-left text-small text-risk-high hover:bg-risk-high-wash"
                onClick={() => {
                  setConfirming(true);
                  setMenuOpen(false);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Xoá khỏi watchlist
              </button>
            </div>
          )}

          {confirming && (
            <div
              role="alertdialog"
              aria-label="Xác nhận xoá khỏi watchlist"
              className="absolute top-[52px] right-0 z-10 w-64 rounded-md border border-line bg-surface p-3 shadow-lift"
            >
              <p className="text-small text-navy">Xoá khỏi watchlist?</p>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  className="h-12 flex-1 bg-risk-high text-white hover:bg-risk-high/90"
                  onClick={() => void remove()}
                  disabled={busy}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Xoá"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 flex-1"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  Giữ
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
        {busy && <Loader2 className="h-4 w-4 animate-spin text-ink-500" aria-hidden />}
        <select
          aria-label="Trạng thái kèo"
          className={`h-12 rounded-[10px] border px-2.5 text-[13px] font-semibold ${STATUS_STYLE[row.status]}`}
          value={row.status}
          disabled={busy}
          onChange={(e) => void changeStatus(e.target.value as WatchlistRowView["status"])}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {labelOf(option)}
            </option>
          ))}
        </select>

        {row.url && (
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex h-12 items-center gap-1.5 rounded-[10px] border border-line px-2.5 text-[13px] font-semibold text-navy"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            Xem tin gốc
          </a>
        )}
      </div>

      {editing ? (
        <div className="mt-3">
          <label className="block text-small font-semibold text-navy" htmlFor={`note-${row.id}`}>
            Ghi chú
          </label>
          <textarea
            id={`note-${row.id}`}
            ref={noteRef}
            value={noteDraft}
            maxLength={WATCHLIST_NOTE_MAX}
            rows={3}
            className="mt-1 w-full rounded-md border border-line bg-surface p-2 text-small text-navy"
            placeholder="Ví dụ: chủ hạ thêm 200 triệu, cần xem trực tiếp."
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void saveNote();
              }
              if (e.key === "Escape") {
                setEditing(false);
                setNoteDraft(row.note ?? "");
              }
            }}
          />
          <div className="mt-1 flex min-h-12 flex-wrap items-center justify-between gap-3">
            <span className="text-micro text-ink-500">
              {noteDraft.length}/{WATCHLIST_NOTE_MAX} ký tự
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                className="h-12 bg-navy px-4 text-white hover:bg-navy/90"
                onClick={() => void saveNote()}
                disabled={busy}
              >
                Lưu
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-12 px-4"
                onClick={() => {
                  setEditing(false);
                  setNoteDraft(row.note ?? "");
                }}
                disabled={busy}
              >
                Huỷ
              </Button>
            </div>
          </div>
          <p className="mt-1 text-micro text-ink-500">Ctrl+Enter để lưu, Esc để huỷ.</p>
        </div>
      ) : row.note ? (
        <div className="mt-3">
          <p className="text-micro font-semibold uppercase tracking-[0.12em] text-ink-500">Ghi chú</p>
          <p className="mt-0.5 whitespace-pre-wrap text-small text-navy">{row.note}</p>
          <button
            type="button"
            className="mt-1 inline-flex h-12 items-center text-small font-semibold text-navy underline underline-offset-2"
            onClick={() => setEditing(true)}
          >
            Sửa
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="mt-3 inline-flex h-12 items-center gap-1.5 text-small font-semibold text-navy underline underline-offset-2"
          onClick={() => setEditing(true)}
        >
          <StickyNote className="h-4 w-4" aria-hidden />
          Thêm ghi chú
        </button>
      )}

      {error && (
        <div role="alert" className="mt-2 rounded-md border border-risk-high/30 bg-risk-high-wash p-2">
          <p className="text-small text-risk-high">{error.message}</p>
          {error.status === 401 && (
            <a href="/login" className="mt-1 inline-flex h-12 items-center text-small font-bold text-risk-high underline">
              Đăng nhập lại
            </a>
          )}
        </div>
      )}
    </li>
  );
}
