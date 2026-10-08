// Từ vựng watchlist — canonical values. Đổi tên = migration ALTER CHECK, đừng
// đổi ở đây trước. Workflow sản phẩm:
//   Mới lưu → Cần gọi → Đã gọi → Đang theo → Bỏ qua
export const WATCHLIST_STATUSES = [
  "moi_luu",
  "can_goi",
  "da_goi",
  "dang_theo",
  "bo_qua",
] as const;

export type WatchlistStatus = (typeof WATCHLIST_STATUSES)[number];

// Map label duy nhất cho UI — component không rải chuỗi trạng thái.
export const WATCHLIST_STATUS_LABEL: Record<WatchlistStatus, string> = {
  moi_luu: "Mới lưu",
  can_goi: "Cần gọi",
  da_goi: "Đã gọi",
  dang_theo: "Đang theo",
  bo_qua: "Bỏ qua",
};

export const WATCHLIST_DEFAULT_STATUS: WatchlistStatus = "moi_luu";

// Khớp CHECK constraint char_length(note) <= 500 trong migration 0024.
export const WATCHLIST_NOTE_MAX = 500;
