"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WatchlistRow } from "./watchlist-row";
import { WATCHLIST_STATUSES, WATCHLIST_STATUS_LABEL } from "@/lib/watchlist/types";
import type { WatchlistRowView } from "@/lib/watchlist/row-view";

type Filter = WatchlistRowView["status"] | "all";
type Sort = "moi_nhat" | "diem_cao" | "gia_thap";

const SORT_OPTIONS: Array<{ value: Sort; label: string }> = [
  { value: "moi_nhat", label: "Mới cập nhật" },
  { value: "diem_cao", label: "Điểm cao nhất" },
  { value: "gia_thap", label: "Giá thấp nhất" },
];

export interface WatchlistListProps {
  /** Danh sách từ server (DB của user). */
  initialRows: WatchlistRowView[];
  /** Tổng số dòng trước filter — dùng cho bộ đếm. */
  total: number;
}

export function WatchlistList({ initialRows, total }: WatchlistListProps) {
  const [rows, setRows] = useState<WatchlistRowView[]>(initialRows);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("moi_nhat");
  /** Thứ tự lúc tải (server đã sort updated_at desc) — đổi status/ghi chú KHÔNG re-sort. */
  const [initialOrder] = useState<Map<string, number>>(
    () => new Map(initialRows.map((r, i) => [r.id, i])),
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of WATCHLIST_STATUSES) map.set(s, 0);
    for (const r of rows) map.set(r.status, (map.get(r.status) ?? 0) + 1);
    return map;
  }, [rows]);

  // Sort chỉ dùng cho "thứ tự hiện tại"; row đổi status KHÔNG re-sort ngay.
  const visible = useMemo(() => {
    const list = filter === "all" ? rows : rows.filter((r) => r.status === filter);
    return [...list].sort((a, b) => {
      if (sort === "diem_cao") return (b.score ?? -1) - (a.score ?? -1);
      if (sort === "gia_thap") return (a.priceVnd ?? Infinity) - (b.priceVnd ?? Infinity);
      // moi_nhat: giữ thứ tự server, row mới (không có trong map) xếp cuối.
      return (initialOrder.get(a.id) ?? rows.length) - (initialOrder.get(b.id) ?? rows.length);
    });
  }, [rows, filter, sort, initialOrder]);

  function onChange(id: string, next: WatchlistRowView) {
    setRows((prev) => prev.map((r) => (r.id === id ? next : r)));
  }

  /** Row không khớp filter — chỉ dùng cho dòng thông báo, KHÔNG render. */
  const hiddenCount =
    filter === "all" ? 0 : rows.filter((r) => r.status !== filter).length;

  function onRemove(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex min-w-0 flex-1 flex-wrap gap-1.5"
          role="group"
          aria-label="Lọc theo trạng thái"
        >
          <FilterChip
            label="Tất cả"
            count={rows.length}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          {WATCHLIST_STATUSES.map((s) => (
            <FilterChip
              key={s}
              label={WATCHLIST_STATUS_LABEL[s]}
              count={counts.get(s) ?? 0}
              active={filter === s}
              onClick={() => setFilter(s)}
            />
          ))}
        </div>

        <label className="flex min-h-12 items-center gap-2 text-small text-ink-600">
          Sắp xếp
          <select
            className="h-12 rounded-md border border-line bg-surface px-2 text-small text-navy"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filter !== "all" && hiddenCount > 0 && (
        <p className="text-small text-ink-600">
          {hiddenCount} kèo đang bị ẩn bởi bộ lọc.{" "}
          <button
            type="button"
            className="min-h-12 font-semibold text-navy hover:underline"
            onClick={() => setFilter("all")}
          >
            Xem tất cả
          </button>
        </p>
      )}

      {rows.length === 0 ? (
        <section className="rounded-lg border border-line bg-surface p-6 text-center">
          <h2 className="text-h3 text-navy">Chưa có kèo nào trong Theo dõi</h2>
          <p className="mt-2 text-small text-ink-600">
            Lưu tin đã kiểm tra hoặc kèo Radar vào đây để theo dõi tay: cập nhật giá, ghi chú
            cuộc gọi, và quay lại nhanh mà không tốn lượt kiểm tra.
          </p>
          <div className="mt-4 flex min-h-12 flex-wrap justify-center gap-2">
            <Button type="button" className="h-12 bg-navy px-4 text-white hover:bg-navy/90" asChild>
              <Link href="/radar">Mở Radar tìm kèo</Link>
            </Button>
            <Button type="button" variant="outline" className="h-12 px-4" asChild>
              <Link href="/#kiem-tra">Kiểm tra một tin</Link>
            </Button>
          </div>
          <p className="mt-3 text-micro text-ink-500">Lưu không tốn lượt kiểm tra.</p>
        </section>
      ) : (
        <ul role="list" className="grid grid-cols-1 gap-3">
          {visible.map((r) => (
            <WatchlistRow
              key={r.id}
              row={r}
              onChange={onChange}
              onRemove={onRemove}
            />
          ))}
          {visible.length === 0 && (
            <li className="rounded-lg border border-line bg-surface p-6 text-center">
              <p className="text-small text-navy">
                Không có kèo ở trạng thái này.
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-3 h-12 px-4"
                onClick={() => setFilter("all")}
              >
                Xem tất cả
              </Button>
            </li>
          )}
        </ul>
      )}

      {rows.length > 0 && (
        <p className="text-micro text-ink-500">
          {filter === "all"
            ? `${rows.length}/${total} kèo`
            : `${counts.get(filter) ?? 0}/${rows.length} kèo ở trạng thái này`}
        </p>
      )}

      <p className="sr-only" aria-live="polite">
        {visible.length} kèo đang hiển thị
      </p>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? "inline-flex h-12 items-center gap-1.5 rounded-full border border-navy bg-navy px-3 text-small font-semibold text-white"
          : "inline-flex h-12 items-center gap-1.5 rounded-full border border-line px-3 text-small text-ink-600 hover:border-navy hover:text-navy"
      }
    >
      {label}
      <span className={active ? "text-gold-soft" : "text-ink-500"}>{count}</span>
    </button>
  );
}
