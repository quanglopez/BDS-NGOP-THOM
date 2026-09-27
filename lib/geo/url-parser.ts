// Lấy ward/region từ URL tin Chợ Tốt / Nhà Tốt.
//
// VẤN ĐỀ THẬT: slug URL là `{ward}-{region}` nối liền bằng dấu "-", ví dụ
//   /mua-ban-nha-dat-quan-6-tp-ho-chi-minh/123456.htm
// Không có gazetteer thì KHÔNG biết chỗ nào hết ward và bắt đầu region.
// Vì vậy hàm này nhận danh sách tên đã biết (lấy từ market_listings đã crawl)
// và chỉ trả kết quả khi tìm được điểm tách khớp với tên thật.
// Không đoán, không throw.

export type GeoSource = "scan" | "url" | null;

export interface ParsedLocation {
  ward_name: string | null;
  region_name: string | null;
  confidence: "high" | "low" | null;
  /** Slug thô sau khi bỏ tiền tố/nhận diện dạng URL, giữ để debug. */
  slug: string | null;
}

export interface KnownArea {
  name: string;
  /** true = tỉnh, false = quận/phường */
  isRegion: boolean;
}

const EMPTY: ParsedLocation = { ward_name: null, region_name: null, confidence: null, slug: null };

/** Bỏ dấu, chữ thường, ký tự lạ -> dạng so khớp với slug. */
export function normalizePlace(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseUrlSafe(url: string | null | undefined): URL | null {
  if (!url || typeof url !== "string") return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Tách slug `{ward}-{region}` bằng danh sách tên đã biết.
 * Thử mọi điểm tách; lấy điểm tách mà ward VÀ region đều khớp tên đã biết.
 * Ưu tiên điểm tách có ward dài nhất (ward thường ít từ hơn region).
 */
function splitWithKnownAreas(slug: string, known: KnownArea[]): ParsedLocation {
  const parts = slug.split("-").filter(Boolean);
  if (parts.length < 2) return { ward_name: null, region_name: null, confidence: "low", slug };

  const areas = known.map((a) => ({ name: a.name, isRegion: a.isRegion, slug: normalizePlace(a.name) })).filter(
    (a) => a.slug && a.slug.includes("-"),
  );
  const regions = areas.filter((a) => a.isRegion);
  const wards = areas.filter((a) => !a.isRegion);
  if (regions.length === 0 || wards.length === 0) {
    // Chưa có dữ liệu đối chiếu -> không đoán
    return { ward_name: null, region_name: null, confidence: "low", slug };
  }

  for (let k = parts.length - 1; k >= 1; k -= 1) {
    const wardSlug = parts.slice(0, k).join("-");
    const regionSlug = parts.slice(k).join("-");
    const region = regions.find((r) => r.slug === regionSlug);
    if (!region) continue;
    const ward = wards.find((w) => w.slug === wardSlug);
    if (!ward) continue;
    return { ward_name: ward.name, region_name: region.name, confidence: "high", slug };
  }
  return { ward_name: null, region_name: null, confidence: "low", slug };
}

/**
 * Parse URL nhà tốt/chợ tốt. KHÔNG BAO GIỜ throw.
 *
 * Hỗ trợ:
 *  - /mua-ban-nha-dat-{ward}-{region}/{id}.htm   -> tách được nếu có tên đã biết
 *  - /tin/{id}.htm, /mua-ban-nha-dat/{id}.htm     -> không có slug -> null
 *  - URL đổi format, URL hỏng, domain lạ          -> null, không throw
 */
export function parseListingLocation(
  url: string | null | undefined,
  knownAreas: KnownArea[] = [],
): ParsedLocation {
  const u = parseUrlSafe(url);
  if (!u) return EMPTY;
  if (!/(^|\.)(nhatot|chotot)\.com$/i.test(u.hostname)) return EMPTY;

  const segments = u.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return EMPTY;

  // Dạng /tin/{id}.htm -> không mang địa lý
  if (segments[0].toLowerCase() === "tin") return EMPTY;

  // Dạng /mua-ban-nha-dat-.../{id}.htm  (slug nằm ở segment đầu)
  const first = segments[0].toLowerCase();
  if (first.startsWith("mua-ban-nha-dat-")) {
    const slug = segments[0].slice("mua-ban-nha-dat-".length);
    if (!slug) return EMPTY;
    return splitWithKnownAreas(slug, knownAreas);
  }
  // Dạng /mua-ban-nha-dat/{id}.htm -> không có slug
  if (first === "mua-ban-nha-dat") return EMPTY;

  // Format lạ: trả null thay vì đoán
  return EMPTY;
}

/**
 * Chọn nguồn địa lý theo thứ tự ưu tiên đã duyệt:
 *   1. category scan (ward + region)
 *   2. URL nhà tốt
 *   3. không xác định được -> ward/region = null, fallback tỉnh
 * Không bao giờ suy đoán.
 */
export function resolveListingGeo(args: {
  scanWard?: string | null;
  scanRegion?: string | null;
  listingUrl?: string | null;
  knownAreas?: KnownArea[];
}): { ward_name: string | null; region_name: string | null; ward_source: GeoSource; region_source: GeoSource } {
  const scanWard = (args.scanWard ?? "").trim();
  const scanRegion = (args.scanRegion ?? "").trim();
  if (scanWard || scanRegion) {
    return {
      ward_name: scanWard || null,
      region_name: scanRegion || null,
      ward_source: scanWard ? "scan" : null,
      region_source: scanRegion ? "scan" : null,
    };
  }

  const parsed = parseListingLocation(args.listingUrl, args.knownAreas ?? []);
  return {
    ward_name: parsed.ward_name,
    region_name: parsed.region_name,
    ward_source: parsed.ward_name ? "url" : null,
    region_source: parsed.region_name ? "url" : null,
  };
}
