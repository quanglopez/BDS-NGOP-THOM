// Row view-model: một dòng watchlist dù anchor là check hay listing.
// Không đọc cột checks/market_listings ở đây — dữ liệu đã được hydrate ở
// lib/watchlist/data.ts. KHÔNG suy diễn field thiếu (không dựng field giả).
import type { WatchlistEntry } from "./data";
import { WATCHLIST_STATUS_LABEL } from "./types";
import type { WatchlistStatus } from "./types";

export type WatchlistRowStatus = WatchlistStatus;

export interface WatchlistRowView {
  id: string;
  anchor: "check" | "listing";
  status: WatchlistStatus;
  statusLabel: string;
  note: string | null;
  title: string;
  url: string | null;
  /** Giá VND (check: price_billion * 1e9; listing: price_vnd). */
  priceVnd: number | null;
  sizeM2: number | null;
  areaName: string | null;
  regionName: string | null;
  province: string | null;
  score: number | null;
  /** Listing anchor chưa chắc đã có check/báo cáo -> null, KHÔNG đoán. */
  reportUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toRowView(entry: WatchlistEntry): WatchlistRowView {
  const base = {
    id: entry.id,
    anchor: entry.anchor,
    status: entry.status,
    statusLabel: labelOf(entry.status),
    note: entry.note,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
  if (entry.anchor === "check" && entry.check) {
    const c = entry.check;
    return {
      ...base,
      title: c.title ?? "Tin đã kiểm tra",
      url: c.listingUrl,
      priceVnd: c.priceBillion !== null ? c.priceBillion * 1e9 : null,
      sizeM2: c.areaM2,
      areaName: null,
      regionName: null,
      province: c.province,
      score: c.score,
      reportUrl: c.seoSlug ? `/bao-cao/${c.seoSlug}` : `/bao-cao/${c.id}`,
    };
  }
  const l = entry.listing;
  return {
    ...base,
    title: l?.title ?? "Tin trên Radar",
    url: l?.url ?? null,
    priceVnd: l?.priceVnd ?? null,
    sizeM2: l?.sizeM2 ?? null,
    areaName: l?.areaName ?? null,
    regionName: l?.regionName ?? null,
    province: null,
    score: null,
    reportUrl: null,
  };
}

export function labelOf(status: WatchlistStatus): string {
  return (WATCHLIST_STATUS_LABEL as Record<WatchlistStatus, string>)[status] ?? status;
}
