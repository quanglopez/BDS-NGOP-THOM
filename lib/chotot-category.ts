// Quét danh mục Chợ Tốt / Nhà Tốt qua gateway API public của họ (không tốn phí,
// không bị Cloudflare chặn như fetch HTML). Dò mã tỉnh/quận lúc chạy bằng chính
// API tìm kiếm rồi cache 1h — vì mã region_v2 các tỉnh không cùng quy ước và
// không có endpoint tra cứu mã.

import { assertPublicUrl, FETCH_UA } from "@/lib/url-guard";
import { adToListing } from "@/lib/chotot";
import { extractPhone } from "@/lib/phone";
import {
  parseCategoryUrl,
  stripAdminPrefix,
  type CategoryKind,
  type CategorySlug,
} from "@/lib/category-slug";

export const GATEWAY_LIST = "https://gateway.chotot.com/v1/public/ad-listing";
const TIMEOUT_MS = 12000;
const PAGE_SIZE = 50;

// Mã danh mục BĐS của Chợ Tốt (đã đo thật): 1000 Đất, 1010 Căn hộ, 1020 Nhà ở
function cgList(kind: CategoryKind): number[] {
  if (kind === "dat") return [1000];
  if (kind === "can-ho") return [1010];
  if (kind === "nha-o") return [1020];
  // nha-dat gộp nhà + đất: quét cả 2 rồi gộp
  return [1020, 1000];
}

export interface CategoryItem {
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
  // Người đăng + SĐT (SĐT lấy từ nội dung tin, gateway Chợ Tốt không trả SĐT thật)
  contactName: string | null;
  phone: string | null;
}

export interface CategoryScope {
  kind: CategoryKind;
  kindLabel: string;
  ward: string | null;
  region: string | null;
  exact: boolean;
  total: number;
  // true khi có filter giá/diện tích/phòng ngủ (tổng phía gateway là tổng thô)
  filtered: boolean;
}

// Bộ lọc quét danh mục. Giá tính theo tỷ, diện tích theo m², phòng ngủ là tối thiểu.
// Gateway Chợ Tốt chỉ lọc được rooms, còn giá/diện tích phải lọc phía mình.
export interface ScanFilters {
  priceMin?: number | null;
  priceMax?: number | null;
  areaMin?: number | null;
  areaMax?: number | null;
  minRooms?: number | null;
}

// Ghi đè khu vực: khi khách muốn lọc chỗ khác với khu vực ghi trong link danh mục
export interface AreaOverride {
  provinceName?: string | null;
  wardSlug?: string | null;
}

// Chuẩn hóa filter từ request: bỏ giá trị rỗng, chặn số âm, min>max thì hoán cho nhau.
// Trả về null nếu không có filter nào hợp lệ (để quét bình thường).
export function normalizeScanFilters(raw: unknown): ScanFilters | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const toNum = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  let priceMin = toNum(r.priceMin);
  let priceMax = toNum(r.priceMax);
  let areaMin = toNum(r.areaMin);
  let areaMax = toNum(r.areaMax);
  const minRooms = toNum(r.minRooms);

  if (priceMin && priceMax && priceMin > priceMax) [priceMin, priceMax] = [priceMax, priceMin];
  if (areaMin && areaMax && areaMin > areaMax) [areaMin, areaMax] = [areaMax, areaMin];

  // Ngưỡng chặn để không quét bừa: giá tối đa 1000 tỷ, diện tích tối đa 10.000 m²
  if (priceMin && priceMin > 1000) priceMin = null;
  if (priceMax && priceMax > 1000) priceMax = 1000;
  if (areaMin && areaMin > 10000) areaMin = null;
  if (areaMax && areaMax > 10000) areaMax = 10000;

  const f: ScanFilters = { priceMin, priceMax, areaMin, areaMax, minRooms: minRooms ?? null };
  const anySet = priceMin || priceMax || areaMin || areaMax || minRooms;
  return anySet ? f : null;
}

export function hasScanFilters(f: ScanFilters | null | undefined): boolean {
  return Boolean(f && (f.priceMin || f.priceMax || f.areaMin || f.areaMax || f.minRooms));
}

// Lọc 1 tin theo filter. Tin thiếu giá/diện tích/phòng bị loại khi có filter tương ứng
// (không đoán bừa để khỏi đưa kèo sai vào danh sách khách chọn).
export function itemMatchesFilters(item: CategoryItem, f: ScanFilters): boolean {
  if (f.priceMin != null && (item.price == null || item.price < f.priceMin * 1_000_000_000)) return false;
  if (f.priceMax != null && (item.price == null || item.price > f.priceMax * 1_000_000_000)) return false;
  if (f.areaMin != null && (item.size == null || item.size < f.areaMin)) return false;
  if (f.areaMax != null && (item.size == null || item.size > f.areaMax)) return false;
  if (f.minRooms != null && (item.rooms == null || item.rooms < f.minRooms)) return false;
  return true;
}

export interface CategoryScan {
  scope: CategoryScope;
  items: CategoryItem[];
  truncated: boolean;
}

type CacheEntry = { value: number; at: number };
const codeCache = new Map<string, CacheEntry>();
const CACHE_TTL = 60 * 60 * 1000;

function cacheGet(key: string): number | null {
  const e = codeCache.get(key);
  if (!e || Date.now() - e.at > CACHE_TTL) return null;
  return e.value;
}

function cacheSet(key: string, value: number) {
  codeCache.set(key, { value, at: Date.now() });
}

async function gatewayGet(params: string): Promise<Record<string, unknown> | null> {
  const checked = await assertPublicUrl(`${GATEWAY_LIST}?${params}`);
  if (!checked.ok) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(checked.url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": FETCH_UA },
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Chuẩn hóa tên địa danh để so khớp: bỏ dấu, bỏ chữ hoa/thường, gộp khoảng trắng
function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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

// Tên truy vấn chuẩn cho 1 tỉnh: label rút gọn ("TP.HCM") không khớp tên đầy đủ
// ("Tp Hồ Chí Minh") khi so chuỗi nên phải mở rộng ra trước khi hỏi gateway
function provinceQuery(provinceName: string): string {
  const n = provinceName.trim().toLowerCase();
  if (n === "tp.hcm" || n === "tphcm" || n === "tp hcm") return "ho chi minh";
  return provinceName;
}

// Dò mã tỉnh (region_v2) bằng API tìm kiếm: hỏi tên tỉnh rồi đọc mã của tin khớp
async function resolveRegionCode(cg: number, provinceName: string): Promise<number | null> {
  const key = `region:${cg}:${normName(provinceName)}`;
  const hit = cacheGet(key);
  if (hit !== null) return hit;

  const query = provinceQuery(provinceName);
  const want = stripAdminWords(normName(query));
  const data = await gatewayGet(`cg=${cg}&limit=50&q=${encodeURIComponent(query)}`);
  const ads = (data?.ads ?? []) as Record<string, unknown>[];
  for (const ad of ads) {
    const name = stripAdminWords(normName(str(ad.region_name)));
    const code = num(ad.region_v2);
    if (code !== null && (name === want || name.includes(want) || want.includes(name))) {
      cacheSet(key, code);
      return code;
    }
  }
  return null;
}

// Dò mã quận (area_v2) tương tự, trong phạm vi tỉnh đã rõ
async function resolveAreaCode(
  cg: number,
  regionV2: number,
  wardSlug: string,
): Promise<number | null> {
  const key = `area:${cg}:${regionV2}:${wardSlug}`;
  const hit = cacheGet(key);
  if (hit !== null) return hit;

  const want = stripAdminWords(normName(stripAdminPrefix(wardSlug).replace(/-/g, " ")));
  const data = await gatewayGet(
    `cg=${cg}&region_v2=${regionV2}&limit=50&q=${encodeURIComponent(want)}`,
  );
  const ads = (data?.ads ?? []) as Record<string, unknown>[];
  for (const ad of ads) {
    const name = stripAdminWords(normName(str(ad.area_name)));
    const code = num(ad.area_v2);
    if (code !== null && (name === want || name.includes(want) || want.includes(name))) {
      cacheSet(key, code);
      return code;
    }
  }
  return null;
}

// URL tin thật trên Chợ Tốt/Nhà Tốt: /mua-ban-nha-dat-{quận}-{tỉnh}/{id}.htm
export function buildListingUrl(id: string, areaName: string, regionName: string): string {
  const slug = (v: string) => normName(v).replace(/ /g, "-").replace(/-+/g, "-");
  const parts = [slug(areaName), slug(regionName)].filter(Boolean).join("-");
  const tail = parts ? `-${parts}` : "";
  return `https://www.nhatot.com/mua-ban-nha-dat${tail}/${id}.htm`;
}

function toItem(ad: Record<string, unknown>): CategoryItem | null {
  const id = str(ad.list_id) || String(num(ad.list_id) ?? "");
  if (!id) return null;
  // Chỉ tin bán; tin cho thuê (type "u") loại ở đây để không lẫn vào danh mục mua bán
  if (str(ad.type) && str(ad.type) !== "s") return null;

  const ward = str(ad.ward_name);
  const area = str(ad.area_name);
  const region = str(ad.region_name);
  const listing = adToListing(ad, `https://www.nhatot.com/tin/${id}.htm`);
  const text = listing?.text ?? "";

  // SĐT: ưu tiên SĐT ghi trong mô tả tin (thật), không có thì bỏ trống —
  // gateway Chợ Tốt chỉ trả SĐT đã che (vd 089899****)
  const phone = extractPhone(text) ?? null;

  return {
    id,
    url: buildListingUrl(id, area, region),
    title: str(ad.subject) || listing?.title || `Tin ${id}`,
    text,
    priceHint: str(ad.price_string) || listing?.priceHint || null,
    areaHint:
      num(ad.size) !== null
        ? `${num(ad.size)} ${str(ad.size_unit_string) || "m²"}`
        : (listing?.areaHint ?? null),
    price: num(ad.price),
    size: num(ad.size),
    rooms: num(ad.rooms),
    ward: ward || area,
    region: region || "",
    image: str(ad.image) || str(ad.thumbnail_image) || null,
    contactName: str(ad.account_name) || str(ad.full_name) || null,
    phone,
  };
}

// Quét danh mục: trả tối đa `limit` tin bán, ưu tiên lọc đúng quận.
// Khi có filter giá/diện tích thì quét sâu hơn (gateway không lọc hộ 2 mục này).
async function scanOneCg(
  cg: number,
  parsed: CategorySlug,
  limit: number,
  filters: ScanFilters | null,
  override: AreaOverride | null,
): Promise<{ items: CategoryItem[]; ward: string | null; region: string | null }> {
  let regionV2: number | null = null;
  let areaV2: number | null = null;
  let region: string | null = null;
  let ward: string | null = null;

  // Khu vực: ưu tiên ghi đè từ filter, không có thì lấy trong link danh mục
  const provinceName = override?.provinceName || parsed.provinceName;
  const wardSlug = override?.wardSlug || parsed.wardSlug;

  if (provinceName) {
    regionV2 = await resolveRegionCode(cg, provinceName);
    if (regionV2 !== null) region = provinceName;
    if (regionV2 !== null && wardSlug) {
      areaV2 = await resolveAreaCode(cg, regionV2, wardSlug);
      if (areaV2 !== null) ward = wardSlug;
    }
  }

  // Gateway lọc hộ số phòng ngủ (rooms) — giá/diện tích lọc phía mình
  const roomsParam = filters?.minRooms ? `&rooms=${Math.floor(filters.minRooms)}` : "";

  const base =
    areaV2 !== null
      ? `cg=${cg}&area_v2=${areaV2}${roomsParam}`
      : regionV2 !== null
        ? `cg=${cg}&region_v2=${regionV2}${roomsParam}`
        : `cg=${cg}${roomsParam}`;

  const items: CategoryItem[] = [];
  let page = 1;
  // 3 trang (150 tin thô) khi không lọc; 8 trang (400 tin thô) khi có filter giá/diện tích
  const maxPages = hasScanFilters(filters) ? 8 : 3;
  while (items.length < limit && page <= maxPages) {
    const data = await gatewayGet(`${base}&limit=${PAGE_SIZE}&page=${page}`);
    if (!data) break;
    const ads = (data.ads ?? []) as Record<string, unknown>[];
    if (ads.length === 0) break;
    for (const ad of ads) {
      const item = toItem(ad);
      if (item && item.text.length >= 120 && (!filters || itemMatchesFilters(item, filters))) {
        items.push(item);
        if (items.length >= limit) break;
      }
    }
    page += 1;
  }

  return { items, ward, region };
}

export async function scanCategoryUrl(
  rawUrl: string,
  limit: number,
  filters: ScanFilters | null = null,
  override: AreaOverride | null = null,
): Promise<{ ok: true; scan: CategoryScan } | { ok: false; reason: string; message: string }> {
  const parsed = parseCategoryUrl(rawUrl);
  if (!parsed) {
    return {
      ok: false,
      reason: "not_category",
      message: "Link này không phải trang danh mục Chợ Tốt/Nhà Tốt. Với link 1 tin, dùng nút Dán link tin rao.",
    };
  }

  const capped = Math.max(1, Math.min(50, Math.floor(limit) || 10));
  const cgs = cgList(parsed.kind);

  let items: CategoryItem[] = [];
  let ward: string | null = null;
  let region: string | null = null;
  let exact = false;
  let total = 0;

  for (const cg of cgs) {
    const r = await scanOneCg(cg, parsed, capped, filters, override);
    ward = ward ?? r.ward;
    region = region ?? r.region;
    items = items.concat(r.items);
    if (items.length >= capped) break;
  }
  items = items.slice(0, capped);

  if (items.length === 0) {
    return {
      ok: false,
      reason: "no_listings",
      message: "Không tìm thấy tin bán nào trong danh mục này. Thử danh mục khác hoặc dán link 1 tin cụ thể.",
    };
  }

  // Tổng số tin Chợ Tốt báo (để UI hiện "tìm thấy N tin")
  const totalData = await gatewayGet(
    ward && region
      ? await totalParams(cgs[0], region, ward)
      : region
        ? await totalParams(cgs[0], region, null)
        : `cg=${cgs[0]}&limit=1`,
  );
  total = Number(totalData?.total ?? items.length) || items.length;

  exact = ward !== null;

  return {
    ok: true,
    scan: {
      scope: {
        kind: parsed.kind,
        kindLabel: parsed.kindLabel,
        ward,
        region,
        exact,
        total,
        filtered: hasScanFilters(filters),
      },
      items,
      truncated: items.length >= capped,
    },
  };
}

// Dựng tham số đếm tổng: cố dò lại mã đã cache để không gọi thừa
async function totalParams(cg: number, region: string, ward: string | null): Promise<string> {
  const regionV2 = await resolveRegionCode(cg, region);
  if (ward && regionV2 !== null) {
    const areaV2 = await resolveAreaCode(cg, regionV2, ward);
    if (areaV2 !== null) return `cg=${cg}&area_v2=${areaV2}&limit=1`;
  }
  if (regionV2 !== null) return `cg=${cg}&region_v2=${regionV2}&limit=1`;
  return `cg=${cg}&limit=1`;
}
