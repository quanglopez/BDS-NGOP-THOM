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

import { normalizePlaceName, type ResolvedAreaCodes } from "./gateway";

export interface GeoCodeRow {
  /** Tên tỉnh đã chuẩn hoá — khoá cache. */
  regionKey: string;
  /** Tên phường đã chuẩn hoá — khoá cache. */
  areaKey: string;
  region_v2: number | null;
  /** Mã QUẬN (gateway). Dùng cho tham số lọc area_v2 khi crawl. */
  area_v2: number;
  /** Mã PHƯỜNG (gateway). NULL = chỉ biết mã quận. Dùng cho scope_key. */
  ward_v2: number | null;
}

export interface GeoAreaMapRepo {
  find(regionKey: string, areaKey: string): Promise<GeoCodeRow | null>;
  /** Ghi cache. KHÔNG BAO GIỜ throw — lỗi cache không được chặn pipeline. */
  save(row: GeoCodeRow): Promise<void>;
}

export interface ResolvedGeo {
  /** Mã cho scope_key: mã phường nếu biết tên phường, mã quận nếu không. */
  areaCode: number;
  /**
   * Mã đưa vào tham số `area_v2` khi crawl. LUÔN là mã quận, vì tham số đó
   * của gateway không hiểu mã phường (area_v2=6885 trả 0 tin).
   */
  crawlAreaCode: number | null;
  /** Tên đã khớp nằm ở cấp nào — quyết định post-filter so `ward` hay `area_v2`. */
  level: "ward" | "area";
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
    resolveAreaCodes(regionName: string, areaName: string): Promise<ResolvedAreaCodes | null>;
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
      // Log chỉ tên địa danh + mã lỗi. KHÔNG log url/title/SĐT/tin đăng.
      const tag = `[geo-resolver] wardName=${areaName || "-"} regionName=${regionName || "-"}`;
      // Không có tên -> không tra. KHÔNG đoán.
      if (!regionKey || !areaKey) {
        console.warn(`${tag} gateway_match=skipped area_v2=- reason=empty_key`);
        return null;
      }

      // 1) Cache hit -> 0 lần gọi gateway.
      // ward_v2 null = dòng này chỉ biết mã quận -> cấp "area", KHÔNG dùng làm
      // mã phường. Nhờ vậy dòng cũ ghi trước khi tách hai cấp vẫn đọc được và
      // chỉ rơi về cấp quận, thay vì trả mã quận cho một scope gắn nhãn phường.
      try {
        const hit = await repo.find(regionKey, areaKey);
        if (hit && Number.isFinite(hit.area_v2) && hit.area_v2 > 0) {
          const isWard = hit.ward_v2 != null && Number.isFinite(hit.ward_v2) && hit.ward_v2 > 0;
          const areaCode = isWard ? hit.ward_v2! : hit.area_v2;
          console.log(
            `${tag} gateway_match=cache area_v2=${areaCode} crawl_area_v2=${hit.area_v2} ` +
              `level=${isWard ? "ward" : "area"} reason=ok`,
          );
          return {
            areaCode,
            crawlAreaCode: hit.area_v2,
            level: isWard ? "ward" : "area",
            region_v2: hit.region_v2,
            fromCache: true,
          };
        }
      } catch (e) {
        // Cache hỏng -> bỏ qua, đi tiếp bằng gateway.
        onCacheError?.("find", e);
        console.warn(`${tag} gateway_match=cache_error area_v2=- reason=cache_read_failed`);
      }

      // 2) Cache miss -> hỏi gateway.
      // Bọc try/catch: lỗi mạng ở đây KHÔNG được làm hỏng cả snapshot.
      // Phải rơi về tầng tỉnh, vì đó là lời nói thật; mất dữ liệu phường thì chấp nhận.
      let codes: ResolvedAreaCodes | null = null;
      try {
        codes = await gateway.resolveAreaCodes(regionName!.trim(), areaName!.trim());
      } catch (e) {
        onCacheError?.("find", e);
        console.warn(`${tag} gateway_match=error area_v2=- reason=gateway_threw`);
        return null;
      }
      if (codes == null || !Number.isFinite(codes.areaCode) || codes.areaCode <= 0) {
        // Trước đây chỗ này return null KHÔNG log -> mất dấu vết khiến tầng
        // phường rơi về tầng tỉnh mà không ai biết vì sao.
        console.warn(`${tag} gateway_match=miss area_v2=- reason=no_code`);
        return null;
      }
      console.log(
        `${tag} gateway_match=gateway area_v2=${codes.areaCode} ` +
          `crawl_area_v2=${codes.crawlAreaCode ?? "-"} level=${codes.level} reason=ok`,
      );

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
      //    Lưu CẢ HAI mã: area_v2 = mã quận (cho crawl), ward_v2 = mã phường
      //    (cho scope). Chỉ lưu một mã thì lần sau cache hit sẽ mất mã kia.
      try {
        await repo.save({
          regionKey,
          areaKey,
          region_v2: regionV2,
          area_v2: codes.crawlAreaCode ?? codes.areaCode,
          ward_v2: codes.level === "ward" ? codes.areaCode : null,
        });
      } catch (e) {
        onCacheError?.("save", e);
      }

      return {
        areaCode: codes.areaCode,
        crawlAreaCode: codes.crawlAreaCode,
        level: codes.level,
        region_v2: regionV2,
        fromCache: false,
      };
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
