// Dựng scope so sánh cho 1 lần check. Hàm thuần, không I/O — tra cứu mã địa phương
// để qua interface để test được, không gọi gateway từ đây.

import {
  SIZE_BAND_RATIO_MAX,
  SIZE_BAND_RATIO_MIN,
  type ScopeLevel,
  type ScopeResolution,
} from "./types";

/** Mã danh mục BĐS của gateway. */
export const CATEGORY = {
  dat: 1000,
  can_ho: 1010,
  nha_o: 1020,
} as const;

export const CATEGORY_LABEL: Record<number, string> = {
  1000: "Đất",
  1010: "Căn hộ",
  1020: "Nhà ở",
};

/**
 * Từ khóa dò loại BĐS. Cố ý THẬN TRỌNG: thiếu hoặc mơ hồ thì trả null
 * (dẫn tới not_enough_data) chứ không đoán — median sai loại còn tệ hơn không có.
 *
 * Từ khóa "specific" (VD "căn hộ", "đất nền") quyết định loại.
 * Từ khóa "generic" ("nhà", "đất") CHỈ được dùng khi không có từ specific nào —
 * vì "nhà ở" hay xuất hiện trong tin căn hộ, và "đất" xuất hiện trong tin đất nền.
 */
const CATEGORY_SPECIFIC: { code: number; words: string[] }[] = [
  {
    code: CATEGORY.can_ho,
    words: ["căn hộ", "can ho", "chung cư", "chung cu", "apartment", "condo", "studio", "penthouse"],
  },
  {
    code: CATEGORY.dat,
    words: [
      "đất nền", "dat nen", "đất ở", "dat o", "đất vườn", "đất thổ", "đất sào",
      "mảnh đất", "manh dat", "lô đất", "lo dat", "thửa đất", "thua dat",
    ],
  },
  {
    code: CATEGORY.nha_o,
    words: [
      "nhà ở", "nha o", "nhà phố", "nha pho", "nhà hộp", "biệt thự", "biet thu",
      "shophouse", "shop nhà", "shop nha", "nhà cấp 4", "nhà bao",
    ],
  },
];

const CATEGORY_GENERIC: { code: number; words: string[] }[] = [
  { code: CATEGORY.dat, words: ["đất", "dat"] },
  { code: CATEGORY.nha_o, words: ["nhà", "nha"] },
  { code: CATEGORY.can_ho, words: ["hộ", "chung cư"] },
];

function scoreWords(text: string, groups: { code: number; words: string[] }[]): Map<number, number> {
  const scores = new Map<number, number>();
  for (const { code, words } of groups) {
    let s = 0;
    for (const w of words) {
      if (text.includes(w)) s += 1;
    }
    if (s > 0) scores.set(code, s);
  }
  return scores;
}

/** Dò trong 1 đoạn văn bản. Hoà ở cùng nhóm -> null, không đoán. */
function detectFrom(text: string): number | null {
  const specific = scoreWords(text, CATEGORY_SPECIFIC);
  if (specific.size > 0) {
    const ranked = [...specific.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length > 1 && ranked[1][1] >= ranked[0][1]) return null;
    return ranked[0][0];
  }
  const generic = scoreWords(text, CATEGORY_GENERIC);
  // Phải đúng một loại mới chấp nhận ("nhà đất" là câu quen thuộc -> không rõ)
  return generic.size === 1 ? [...generic.keys()][0] : null;
}

/**
 * Dò loại BĐS từ nội dung tin.
 * Ưu tiên dò trong TIÊU ĐỀ (dòng đầu) — đây là chỗ tác giả ghi loại BĐS rõ nhất.
 * Nếu tiêu đề mơ hồ thì mới dò toàn văn. Hoà ở cùng nhóm -> null.
 * KHÔNG BAO GIỜ trả mặc định: sai loại làm hỏng cả nhóm tham chiếu.
 */
export function detectCategoryCode(text: string | null | undefined): number | null {
  const full = (text ?? "").toLowerCase().trim();
  if (!full) return null;

  const firstLine = full.split("\n")[0].slice(0, 160).trim();
  if (firstLine) {
    const fromTitle = detectFrom(firstLine);
    if (fromTitle != null) return fromTitle;
  }

  return detectFrom(full);
}

/** Band diện tích động theo diện tích tin: 0.6× .. 1.6×. */
export function buildSizeBand(areaM2: number | null | undefined): {
  min: number | null;
  max: number | null;
} {
  if (areaM2 == null || !Number.isFinite(areaM2) || !(areaM2 > 0)) return { min: null, max: null };
  return {
    min: Math.max(1, Math.round(areaM2 * SIZE_BAND_RATIO_MIN)),
    max: Math.round(areaM2 * SIZE_BAND_RATIO_MAX),
  };
}

/** Band phòng: bedrooms-1 .. bedrooms+1, sàn tối thiểu 1. Không có bedrooms -> không lọc. */
export function buildRoomsBand(bedrooms: number | null | undefined): {
  min: number | null;
  max: number | null;
} {
  if (bedrooms == null || !Number.isFinite(bedrooms) || !(bedrooms > 0)) return { min: null, max: null };
  const b = Math.floor(bedrooms);
  return { min: Math.max(1, b - 1), max: b + 1 };
}

export interface ScopeInput {
  categoryCode: number | null;
  regionName: string | null;
  wardName: string | null;
  regionV2: number | null;
  areaM2: number | null;
  bedrooms: number | null;
}

/** Tra cứu mã địa phương. Cài bằng pipeline (đọc market_listings), test bằng fake. */
export interface WardIndex {
  /** Trả mã quận nếu từng thấy phường này trong dữ liệu đã crawl. */
  findAreaV2(areaName: string, regionName: string | null): { areaV2: number; areaName: string } | null;
  /** Trả mã tỉnh từ dữ liệu đã crawl. */
  findRegionV2(regionName: string | null): number | null;
}

export function buildScopeKey(args: {
  scopeLevel: ScopeLevel;
  geoCode: number;
  categoryCode: number;
  sizeMin: number | null;
  sizeMax: number | null;
  roomsMin: number | null;
  roomsMax: number | null;
}): string {
  const band = args.sizeMin != null && args.sizeMax != null ? `${args.sizeMin}-${args.sizeMax}` : "na";
  const rooms =
    args.roomsMin != null && args.roomsMax != null ? `${args.roomsMin}-${args.roomsMax}` : "na";
  return [
    `${args.scopeLevel}:${args.geoCode}`,
    `cat:${args.categoryCode}`,
    `size:${band}`,
    `rooms:${rooms}`,
  ].join("|");
}

function describe(args: {
  scopeLevel: ScopeLevel;
  areaName: string | null;
  regionName: string | null;
  categoryCode: number;
}): string {
  const cat = CATEGORY_LABEL[args.categoryCode] ?? "Bất động sản";
  if (args.scopeLevel === "ward" && args.areaName) {
    return `${args.areaName}${args.regionName ? `, ${args.regionName}` : ""} · ${cat}`;
  }
  return `${args.regionName ?? "Khu vực"} · ${cat}`;
}

/**
 * Dựng scope theo 2 tầng.
 *  Tier 1: cùng phường (cần areaName + tra được areaV2 từ dữ liệu đã crawl)
 *  Tier 2: cùng tỉnh   (cần regionV2)
 *  Không đủ dữ liệu -> not_enough_data, KHÔNG crawl mù.
 */
export function resolveScope(input: ScopeInput, wardIndex: WardIndex): ScopeResolution {
  if (!input.categoryCode) {
    return {
      ok: false,
      reason: "Chưa xác định được loại bất động sản để tạo nhóm tham chiếu phù hợp.",
    };
  }

  const size = buildSizeBand(input.areaM2);
  const rooms = buildRoomsBand(input.bedrooms);
  const catName = CATEGORY_LABEL[input.categoryCode] ?? null;

  // Tier 1 — cùng phường
  if (input.wardName && input.wardName.trim()) {
    const hit = wardIndex.findAreaV2(input.wardName.trim(), input.regionName);
    if (hit) {
      return {
        ok: true,
        tier: 1,
        scope: {
          scope_level: "ward",
          scope_key: buildScopeKey({
            scopeLevel: "ward",
            geoCode: hit.areaV2,
            categoryCode: input.categoryCode,
            sizeMin: size.min,
            sizeMax: size.max,
            roomsMin: rooms.min,
            roomsMax: rooms.max,
          }),
          scope_description: describe({
            scopeLevel: "ward",
            areaName: hit.areaName,
            regionName: input.regionName,
            categoryCode: input.categoryCode,
          }),
          region_name: input.regionName,
          area_name: hit.areaName,
          category_code: input.categoryCode,
          category_name: catName,
          size_min_m2: size.min,
          size_max_m2: size.max,
          rooms_min: rooms.min,
          rooms_max: rooms.max,
        },
      };
    }
  }

  // Tier 2 — cùng tỉnh
  if (input.regionV2 != null) {
    return {
      ok: true,
      tier: 2,
      scope: {
        scope_level: "province",
        scope_key: buildScopeKey({
          scopeLevel: "province",
          geoCode: input.regionV2,
          categoryCode: input.categoryCode,
          sizeMin: size.min,
          sizeMax: size.max,
          roomsMin: rooms.min,
          roomsMax: rooms.max,
        }),
        scope_description: describe({
          scopeLevel: "province",
          areaName: null,
          regionName: input.regionName,
          categoryCode: input.categoryCode,
        }),
        region_name: input.regionName,
        area_name: null,
        category_code: input.categoryCode,
        category_name: catName,
        size_min_m2: size.min,
        size_max_m2: size.max,
        rooms_min: rooms.min,
        rooms_max: rooms.max,
      },
    };
  }

  return {
    ok: false,
    reason: "Chưa xác định được khu vực để tạo nhóm tin tham chiếu phù hợp.",
  };
}
