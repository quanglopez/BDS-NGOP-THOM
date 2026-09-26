// Client helper: quét trang danh mục Chợ Tốt/Nhà Tốt -> danh sách tin để chọn rồi check

export interface CategoryScanItem {
  id: string;
  url: string;
  title: string;
  text: string;
  priceHint: string | null;
  areaHint: string | null;
  price: number | null;
  size: number | null;
  rooms: number | null;
  ward: string;
  region: string;
  image: string | null;
  contactName: string | null;
  phone: string | null;
}

export interface CategoryScanOk {
  ok: true;
  limit: number;
  scope: {
    kind: string;
    kindLabel: string;
    ward: string | null;
    region: string | null;
    exact: boolean;
    total: number;
    filtered: boolean;
  };
  items: CategoryScanItem[];
  truncated: boolean;
}

// Bộ lọc gửi kèm khi quét: giá theo tỷ, diện tích theo m², số phòng ngủ là tối thiểu
export interface ScanFiltersInput {
  priceMin?: number | null;
  priceMax?: number | null;
  areaMin?: number | null;
  areaMax?: number | null;
  minRooms?: number | null;
}

export interface AreaOverrideInput {
  provinceName?: string | null;
  wardSlug?: string | null;
}

export interface CategoryScanErr {
  ok: false;
  reason: string;
  message: string;
}

export async function scanCategory(
  url: string,
  filters?: ScanFiltersInput | null,
  areaOverride?: AreaOverrideInput | null,
): Promise<CategoryScanOk | CategoryScanErr> {
  try {
    const res = await fetch("/api/category-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        ...(filters ? { filters } : {}),
        ...(areaOverride ? { areaOverride } : {}),
      }),
    });
    const data = await res.json();

    if (!res.ok || data.ok === false) {
      return { ok: false, reason: data.reason ?? "error", message: data.message ?? "Không quét được danh mục." };
    }
    return data as CategoryScanOk;
  } catch {
    return { ok: false, reason: "network_error", message: "Lỗi mạng, thử lại sau." };
  }
}
