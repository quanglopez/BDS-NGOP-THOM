// Price Intelligence V2 — tra mã địa danh (tên -> area_v2/region_v2).
//
// VÌ SAO CÓ MODULE NÀY:
// Trước V2, tìm area_v2 chỉ tra được từ market_listings — bảng giá. Bảng đó chỉ
// có dữ liệu SAU lần crawl giá đầu tiên, nên khu vực mới luôn rơi về tầng tỉnh.
// V2 tách phần tra cứu ra gazetteer riêng (bảng geo_area_map) và điền nó từ
// gateway khi gặp khu vực lần đầu.
//
// NGUYÊN TẮC:
//   - Không AI, không suy đoán. Chỉ nhận mã khi gateway XÁC NHẬN khớp chính xác
//     (xem placeNameMatches). Trượt -> null -> rơi tầng tỉnh.
//   - Cache là TỐI ƯU, không phải nguồn sự thật. Lỗi cache không được làm hỏng
//     pipeline: đọc/ghi cache đều nuốt lỗi, fallback sang gateway.
//   - Chỉ ghi cache khi ĐÃ có mã. Không ghi null — tránh ghi đè kết quả tốt.

import { normalizePlaceName } from "./gateway";

export interface GeoCodeRow {
  /** Tên tỉnh đã chuẩn hoá — khoá cache. */
  regionKey: string;
  /** Tên phường đã chuẩn hoá — khoá cache. */
  areaKey: string;
  region_v2: number | null;
  area_v2: number;
}

export interface GeoAreaMapRepo {
  find(regionKey: string, areaKey: string): Promise<GeoCodeRow | null>;
  /** Ghi cache. KHÔNG BAO GIỜ throw — lỗi cache không được chặn pipeline. */
  save(row: GeoCodeRow): Promise<void>;
}

export interface ResolvedGeo {
  area_v2: number;
  region_v2: number | null;
  /** true = đọc từ cache, không gọi gateway. */
  fromCache: boolean;
}

export interface GeoResolver {
  resolveAreaCode(
    regionName: string | null | undefined,
    areaName: string | null | undefined,
    opts?: { regionV2Hint?: number | null },
  ): Promise<ResolvedGeo | null>;
}

export interface GeoResolverDeps {
  repo: GeoAreaMapRepo;
  /** Chỉ cần 2 hàm resolve của gateway; test được bằng stub. */
  gateway: {
    resolveRegionCode(regionName: string): Promise<number | null>;
    resolveAreaCode(regionName: string, areaName: string): Promise<number | null>;
  };
  /** Ghi log cảnh báo. Mặc định im lặng. */
  onCacheError?: (stage: "find" | "save", error: unknown) => void;
}

export function createGeoResolver(deps: GeoResolverDeps): GeoResolver {
  const { repo, gateway, onCacheError } = deps;

  return {
    async resolveAreaCode(regionName, areaName, opts) {
      const regionKey = normalizePlaceName((regionName ?? "").trim());
      const areaKey = normalizePlaceName((areaName ?? "").trim());
      // Không có tên -> không tra. KHÔNG đoán.
      if (!regionKey || !areaKey) return null;

      // 1) Cache hit -> 0 lần gọi gateway.
      try {
        const hit = await repo.find(regionKey, areaKey);
        // > 0 chứ không chỉ isFinite: 0 là số hợp lệ về toán học nhưng KHÔNG
        // phải mã địa danh — chấp nhận nó sẽ sinh scope_key rác.
        if (hit && Number.isFinite(hit.area_v2) && hit.area_v2 > 0) {
          return { area_v2: hit.area_v2, region_v2: hit.region_v2, fromCache: true };
        }
      } catch (e) {
        // Cache hỏng -> bỏ qua, đi tiếp bằng gateway.
        onCacheError?.("find", e);
      }

      // 2) Cache miss -> hỏi gateway.
      // Bọc try/catch: lỗi mạng ở đây KHÔNG được làm hỏng cả snapshot.
      // Phải rơi về tầng tỉnh, vì đó là lời nói thật; mất dữ liệu phường thì chấp nhận.
      let areaV2: number | null = null;
      try {
        areaV2 = await gateway.resolveAreaCode(regionName!.trim(), areaName!.trim());
      } catch (e) {
        onCacheError?.("find", e);
        return null;
      }
      if (areaV2 == null || !Number.isFinite(areaV2) || areaV2 <= 0) return null;

      // 3) Mã tỉnh: ưu tiên gợi ý của pipeline (đã resolve rồi) để khỏi gọi
      //    gateway lần nữa. Chỉ hỏi gateway khi thật sự chưa biết.
      let regionV2 = opts?.regionV2Hint ?? null;
      if (regionV2 == null || !Number.isFinite(regionV2) || regionV2 <= 0) {
        try {
          regionV2 = await gateway.resolveRegionCode(regionName!.trim());
        } catch (e) {
          onCacheError?.("find", e);
        }
      }

      // 4) Lưu cache. Best-effort: hỏng thì lần sau hỏi lại gateway.
      try {
        await repo.save({ regionKey, areaKey, region_v2: regionV2, area_v2: areaV2 });
      } catch (e) {
        onCacheError?.("save", e);
      }

      return { area_v2: areaV2, region_v2: regionV2, fromCache: false };
    },
  };
}

/** Repo in-memory — dùng cho test và cho môi trường không có Supabase. */
export function inMemoryGeoAreaMap(seed: GeoCodeRow[] = []): GeoAreaMapRepo {
  const rows = new Map<string, GeoCodeRow>();
  for (const r of seed) rows.set(`${r.regionKey}|${r.areaKey}`, r);
  return {
    async find(regionKey, areaKey) {
      return rows.get(`${regionKey}|${areaKey}`) ?? null;
    },
    async save(row) {
      rows.set(`${row.regionKey}|${row.areaKey}`, row);
    },
  };
}
