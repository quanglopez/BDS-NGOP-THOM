// Adapter đọc dữ liệu giá từ vendor. Mục đích: Chợ Tốt đổi API thì chỉ file này
// bị đụng, phần còn lại (scope/stats/pipeline) không biết vendor là ai.
//
// ĐÃ ĐO capability thật của gateway.chotot.com (2026-09):
//   - limit: tối đa 50 tin/lần          -> CÓ
//   - page: BỊ BỎ QUA (mọi page trả cùng lát đầu)  -> KHÔNG
//   - sort: BỊ BỎ QUA                     -> KHÔNG
//   - size=A-B (dấu gạch)                 -> CÓ (dấu phẩy thì API trả lỗi)
//   - price=A-B, rooms, cg, region_v2, area_v2, q -> CÓ
//   - KHÔNG có filter ngày đăng
//   - KHÔNG có endpoint 1 ad theo id (chưa verify được) -> không suy ra lat/lng cho tin đang check
//   - total ở cấp tỉnh bị trần 10000 => không tin được, chỉ dùng total cấp quận
//
// Hệ quả: KHÔNG THỂ dựng median toàn thị trường. Chỉ dựng được thống kê của một lát
// đã lọc, và phải ghi rõ sample_size + scope + thời điểm.

import { assertPublicUrl, FETCH_UA } from "@/lib/url-guard";

export const GATEWAY_LIST = "https://gateway.chotot.com/v1/public/ad-listing";
const TIMEOUT_MS = 12000;

/** Một truy vấn lấy tin. Mọi tham số đều optional để dùng được cho cả probe lẫn crawl. */
export interface FetchScope {
  categoryCode: number;
  regionV2?: number | null;
  areaV2?: number | null;
  sizeMinM2?: number | null;
  sizeMaxM2?: number | null;
  rooms?: number | null;
  priceMinVnd?: number | null;
  priceMaxVnd?: number | null;
  query?: string | null;
  limit?: number;
}

/** Dữ liệu thô đúng như vendor trả về. Không chuẩn hoá ở tầng này. */
export interface RawMarketAd {
  list_id: number | string;
  type?: string;
  category?: number;
  category_name?: string;
  region_v2?: number;
  region_name?: string;
  area_v2?: number;
  area_name?: string;
  /**
   * Mã PHƯỜNG/XÃ. Khác `area_v2` (mã quận/huyện) — ví dụ cùng một quận có
   * nhiều phường, mỗi phường một `ward` riêng. Không phải số nào cũng có:
   * tin cũ hoặc tin không gắn phường có thể thiếu field này.
   */
  ward?: unknown;
  subject?: string;
  price?: number;
  price_string?: string;
  size?: number;
  size_unit_string?: string;
  living_size?: number;
  length?: number;
  width?: number;
  rooms?: number;
  latitude?: number;
  longitude?: number;
  list_time?: number;
  is_price_not_valid?: boolean;
  is_sticky?: boolean;
  company_ad?: boolean;
  job_tier?: number;
  account_name?: string;
  [k: string]: unknown;
}

export interface MarketGateway {
  readonly source: string;
  /** true nếu vendor cho phép phân trang. Hiện false — pipeline phải partition thay vì page. */
  readonly supportsPagination: boolean;
  /** Số tin tối đa 1 lần gọi. */
  readonly maxItemsPerRequest: number;
  fetchListings(scope: FetchScope): Promise<RawMarketAd[]>;
  /**
   * Bản CÓ trạng thái lỗi, dành riêng cho crawl. Optional để fake cũ (chỉ
   * implement `fetchListings`) vẫn dùng được — khi thiếu, pipeline coi kết quả
   * là thành công, đúng như hành vi cũ.
   */
  fetchListingsResult?(scope: FetchScope): Promise<GatewayFetchResult>;
  /** Trả total của truy vấn. CHỈ tin cậy được ở cấp quận, không tin ở cấp tỉnh (bị trần 10000). */
  fetchTotal(scope: FetchScope): Promise<number | null>;
  /** Dò mã tỉnh (region_v2) từ tên tỉnh. */
  resolveRegionCode(regionName: string): Promise<number | null>;
  /** Dò mã địa danh, trả CẢ HAI mã (xem ResolvedAreaCodes). */
  resolveAreaCodes(regionName: string, areaName: string): Promise<ResolvedAreaCodes | null>;
  /**
   * Chỉ mã dùng cho scope_key. Giữ lại cho call cũ / test cũ.
   * Dùng khi chỉ cần scope thì gọi resolveAreaCodes rồi lấy .areaCode.
   */
  resolveAreaCode(regionName: string, areaName: string): Promise<number | null>;
}

/**
 * Gateway có HAI loại mã cho cùng một địa danh, và chúng dùng cho hai việc khác nhau:
 *
 *   ward (6885)   -> mã PHƯỜNG. Dùng cho scope_key, để scope gắn nhãn "phường".
 *   area (301704) -> mã QUẬN.  Dùng cho tham số lọc `area_v2` khi crawl, vì
 *                    tham số đó CHỈ hiểu mã quận: area_v2=6885 trả HTTP 200
 *                    nhưng 0 tin.
 *
 * Gộp hai mã này làm một là gốc rễ của cả hai lỗi: scope ghi mã quận cho tên
 * phường, hoặc crawl trả 0 mẫu. Vì vậy trả cả hai, để tầng trên tự chọn đúng
 * mã cho từng mục đích.
 */
export interface ResolvedAreaCodes {
  /** Mã cho scope_key: mã phường nếu khớp tên phường, mã quận nếu khớp tên quận. */
  areaCode: number;
  /** Mã đưa vào tham số area_v2 khi crawl. LUÔN là mã quận. null = tin khớp không có area_v2. */
  crawlAreaCode: number | null;
  /** Tên đã khớp nằm ở cấp nào — quyết định post-filter so sánh `ward` hay `area_v2`. */
  level: "ward" | "area";
}

/** Ghép tham số. Band dùng dấu gạch nối — gateway từ chối dấu phẩy. */
export function buildGatewayParams(scope: FetchScope): string {
  const p = new URLSearchParams();
  p.set("cg", String(scope.categoryCode));
  if (scope.regionV2 != null) p.set("region_v2", String(scope.regionV2));
  if (scope.areaV2 != null) p.set("area_v2", String(scope.areaV2));
  if (scope.sizeMinM2 != null && scope.sizeMaxM2 != null) {
    p.set("size", `${scope.sizeMinM2}-${scope.sizeMaxM2}`);
  }
  if (scope.rooms != null) p.set("rooms", String(Math.floor(scope.rooms)));
  if (scope.priceMinVnd != null && scope.priceMaxVnd != null) {
    p.set("price", `${Math.round(scope.priceMinVnd)}-${Math.round(scope.priceMaxVnd)}`);
  }
  if (scope.query) p.set("q", scope.query);
  p.set("limit", String(Math.min(50, Math.max(1, scope.limit ?? 50))));
  return p.toString();
}

/**
 * Kết quả MỘT lần gọi gateway cho mục đích CRAWL.
 *
 * `ok = false` nghĩa là TA KHÔNG BIẾT còn bao nhiêu tin — mạng lỗi, timeout,
 * HTTP lỗi, body không đọc được. Tách khỏi `ok = true, ads = []` là bắt buộc:
 * trước đây cả hai đều thành `[]` và pipeline tưởng là khu vực hết tin, rồi lưu
 * `sample_size=0` vào `market_price_stats` — `get()` đọc lại đúng dòng đó cả ngày
 * và không bao giờ crawl lại.
 */
export interface GatewayFetchResult {
  ok: boolean;
  ads: RawMarketAd[];
}

interface GatewayResponse {
  ok: boolean;
  data: Record<string, unknown> | null;
}

async function gatewayJsonDetailed(params: string): Promise<GatewayResponse> {
  const checked = await assertPublicUrl(`${GATEWAY_LIST}?${params}`);
  if (!checked.ok) return { ok: false, data: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(checked.url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": FETCH_UA },
    });
    if (!res.ok) return { ok: false, data: null };
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    // 200 nhưng body không đọc được -> KHÔNG phải "khu vực hết tin".
    if (data === null) return { ok: false, data: null };
    return { ok: true, data };
  } catch {
    return { ok: false, data: null };
  } finally {
    clearTimeout(timer);
  }
}

async function gatewayJson(params: string): Promise<Record<string, unknown> | null> {
  return (await gatewayJsonDetailed(params)).data;
}

// Chuẩn hoá tên địa danh để so khớp: bỏ dấu, bỏ chữ hoa/thường, gộp khoảng trắng
function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripAdminWords(s: string): string {
  return s
    .replace(/^(quan|huyen|thanh pho|thi xa|phuong|xa|thi tran|khu pho|tp)\s+/i, "")
    .trim();
}

/**
 * Tên địa danh đã chuẩn hoá: bỏ dấu, lowercase, bỏ prefix hành chính.
 *
 * Dùng làm khoá cache của geo_area_map V2. PHẢI là đúng hàm mà resolveAreaCode
 * dùng để so khớp — nếu hai nơi chuẩn hoá lệch nhau thì cache sẽ vô hiệu hoặc,
 * tệ hơn, trả mã của địa danh khác.
 */
export function normalizePlaceName(s: string): string {
  return stripAdminWords(normName(s));
}

/**
 * So khớp tên địa danh ĐÚNG KỸ sau khi chuẩn hoá.
 *
 * KHÔNG dùng includes: tên địa danh ở VN có số thứ tự (Phường 1..28, Xã 1..X).
 * "Phường 11" -> "11", "Phường 1" -> "1", mà "11".includes("1") === true nên
 * includes sẽ trả mã của Phường 1 cho Phường 11 — scope sai địa lý nhưng vẫn
 * trông hợp lệ, nguy hiểm hơn hẳn rơi về tầng tỉnh.
 *
 * Trượt thì trả false để rơi về tầng tỉnh: an toàn hơn là đoán sai.
 */
export function placeNameMatches(name: string, want: string): boolean {
  return name === want;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Mã phường (`ward`). Bắt buộc > 0: 0 hợp lệ về toán học nhưng KHÔNG phải mã
 * địa danh — trả 0 sẽ sinh scope_key rác rồi được ghi vĩnh viễn vào geo_area_map.
 */
function wardCode(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}

export class ChototGatewayAdapter implements MarketGateway {
  readonly source = "chotot_gateway";
  readonly supportsPagination = false;
  readonly maxItemsPerRequest = 50;

  async fetchListingsResult(scope: FetchScope): Promise<GatewayFetchResult> {
    const res = await gatewayJsonDetailed(buildGatewayParams(scope));
    const ads = res.ok ? (res.data?.ads ?? []) : [];
    return { ok: res.ok, ads: Array.isArray(ads) ? ads : [] };
  }

  async fetchListings(scope: FetchScope): Promise<RawMarketAd[]> {
    // GIỮ NGUYÊN hành vi cũ: lỗi -> mảng rỗng. Chỉ dùng cho tra cứu tên/mã
    // (resolveRegionCode, resolveAreaCodes) nơi null là kết quả hợp lệ.
    return (await this.fetchListingsResult(scope)).ads;
  }

  async fetchTotal(scope: FetchScope): Promise<number | null> {
    const data = await gatewayJson(buildGatewayParams({ ...scope, limit: 1 }));
    const t = num(data?.total);
    return t !== null ? t : null;
  }

  async resolveRegionCode(regionName: string): Promise<number | null> {
    // Nhãn rút gọn ("TP.HCM") không khớp tên đầy đủ ("Tp Hồ Chí Minh") khi so chuỗi
    const n = regionName.trim().toLowerCase();
    const query = n === "tp.hcm" || n === "tphcm" || n === "tp hcm" ? "ho chi minh" : regionName;
    const want = normalizePlaceName(query);
    for (const cg of [1020, 1010, 1000]) {
      const ads = await this.fetchListings({ categoryCode: cg, query, limit: 50 });
      for (const ad of ads) {
        const name = normalizePlaceName(str(ad.region_name));
        const code = num(ad.region_v2);
        if (code !== null && placeNameMatches(name, want)) return code;
      }
    }
    return null;
  }

  async resolveAreaCodes(regionName: string, areaName: string): Promise<ResolvedAreaCodes | null> {
    const regionV2 = await this.resolveRegionCode(regionName);
    if (regionV2 === null) return null;
    const want = normalizePlaceName(areaName);
    for (const cg of [1020, 1010, 1000]) {
      const ads = await this.fetchListings({ categoryCode: cg, regionV2, query: want, limit: 50 });
      for (const ad of ads) {
        // PHẢI đúng tỉnh đang hỏi. Tin cùng tên ở tỉnh khác ("Phường 1" có ở
        // cả Hà Nội lẫn TP.HCM) sẽ ra mã sai, và mã sai đó được ghi VĨNH VIỄN
        // vào geo_area_map — không có TTL, không tự sửa. Không được tin tuyệt
        // đối rằng gateway đã lọc đúng.
        const adRegion = num(ad.region_v2);
        if (adRegion !== null && adRegion !== regionV2) continue;
        const district = num(ad.area_v2);
        // Tên địa danh cần tra nằm ở field KHÁC NHAU tùy cấp hành chính:
        //   - tên PHƯỜNG/XÃ   -> ad.ward_name  ("Phường An Hải Bắc")
        //   - tên QUẬN/HUYỆN  -> ad.area_name  ("Quận Sơn Trà")
        // Trước đây chỉ so với ad.area_name, nên mọi tên phường đều trượt vĩnh
        // viễn (tên phường không bao giờ bằng tên quận) và mọi check có ward đều
        // rơi về tầng tỉnh. Thử ward_name TRƯỚC, area_name SAU.
        // Cả hai đều so KHỚP TUYỆT ĐỐI sau khi chuẩn hoá (xem placeNameMatches):
        // KHÔNG dùng includes, vì "Phường 1" là chuỗi con của "Phường 11" và sẽ
        // trả mã của phường khác — mã sai đó lại được ghi vĩnh viễn.
        const ward = normalizePlaceName(str(ad.ward_name));
        if (ward && placeNameMatches(ward, want)) {
          const byWard = wardCode(ad.ward);
          if (byWard !== null) {
            // scope lấy mã PHƯỜNG, crawl lấy mã QUẬN của đúng tin này.
            return { areaCode: byWard, crawlAreaCode: district, level: "ward" };
          }
          // Tin không gắn mã phường -> chỉ còn mã quận, thành cấp quận.
          if (district !== null) return { areaCode: district, crawlAreaCode: district, level: "area" };
          continue;
        }
        const area = normalizePlaceName(str(ad.area_name));
        if (area && placeNameMatches(area, want) && district !== null) {
          return { areaCode: district, crawlAreaCode: district, level: "area" };
        }
      }
    }
    return null;
  }

  /** Chỉ mã cho scope_key. Xem resolveAreaCodes. */
  async resolveAreaCode(regionName: string, areaName: string): Promise<number | null> {
    const r = await this.resolveAreaCodes(regionName, areaName);
    return r ? r.areaCode : null;
  }
}
