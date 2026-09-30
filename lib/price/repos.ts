// Hiện thực 2 repo của Price Intelligence trên Supabase.
// Ghi/đọc market_* đều qua service role vì các bảng này bật RLS không policy
// (client không được đụng tới). Snapshot trên checks dùng admin client vì
// bảng checks không có update policy cho user.

import type { SupabaseClient } from "@supabase/supabase-js";
import { PricePipelineError } from "./errors";
import type { MarketListingRepo, PriceStatsRepo } from "./pipeline";
import type { GeoAreaMapRepo } from "./geo-resolver";
import type { KnownArea } from "@/lib/geo/url-parser";
import type { NormalizedListing, PriceScope, PriceStatsRow } from "./types";

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function toIso(v: unknown): string {
  return typeof v === "string" ? v : new Date().toISOString();
}

function rowToListing(r: Record<string, unknown>): NormalizedListing {
  return {
    source: String(r.source),
    external_id: String(r.external_id),
    category_code: num(r.category_code),
    category_name: str(r.category_name),
    region_name: str(r.region_name),
    region_v2: num(r.region_v2),
    area_name: str(r.area_name),
    area_v2: num(r.area_v2),
    title: str(r.title),
    price_vnd: num(r.price_vnd),
    size_m2: num(r.size_m2),
    living_size_m2: num(r.living_size_m2),
    land_front_m: num(r.land_front_m),
    land_side_m: num(r.land_side_m),
    rooms: num(r.rooms),
    price_per_m2: num(r.price_per_m2) ?? 0,
    lat: num(r.lat),
    lng: num(r.lng),
    listed_at: str(r.listed_at),
    url: str(r.url),
    is_price_valid: r.is_price_valid !== false,
    is_promoted: r.is_promoted === true,
    is_rent: r.is_promoted === true ? false : r.is_rent === true,
  };
}

export function supabaseMarketListings(admin: SupabaseClient): MarketListingRepo {
  return {
    async upsertMany(listings) {
      if (listings.length === 0) return;
      // upsert theo (source, external_id), giữ first_seen_at, đẩy last_seen_at.
      //
      // KHÔNG được gửi `first_seen_at: undefined` để "giữ" cột này. supabase-js
      // lấy danh sách cột cho tham số `columns=` từ KEYS của object, nên undefined
      // vẫn khiến first_seen_at có mặt trong columns=; nhưng JSON.stringify() bỏ
      // mất value -> PostgREST insert NULL tường minh, mà NULL tường minh KHÔNG
      // rơi về DEFAULT now(). Cột là NOT NULL nên mọi batch đều chết:
      //   23502 null value in column "first_seen_at" ... violates not-null constraint
      // và cả bảng market_listings rỗng (0 dòng) vì không batch nào sống sót.
      //
      // Bỏ hẳn khỏi payload: insert thì DB tự lấy DEFAULT now(), còn khi conflict
      // thì cột này không nằm trong danh sách update nên giữ nguyên giá trị cũ.
      const { error } = await admin
        .from("market_listings")
        .upsert(
          listings.map((l) => ({
            ...l,
            last_seen_at: new Date().toISOString(),
          })),
          { onConflict: "source,external_id", ignoreDuplicates: false },
        );
      if (error) throw new PricePipelineError("listing_upsert_failed");
    },

    findAreaV2(areaName, regionName) {
      // Chỉ đọc đồng bộ trong request -> dùng cache trong bộ nhớ cho request này.
      // Nếu chưa có trong DB thì trả null, pipeline sẽ lùi về tầng tỉnh.
      return lookupAreaV2(areaName, regionName);
    },

    findRegionV2(regionName) {
      if (!regionName) return null;
      return lookupRegionV2(regionName);
    },

    async listByGeo({ regionV2, areaV2, categoryCode }) {
      let q = admin.from("market_listings").select("*").eq("category_code", categoryCode);
      if (areaV2 != null) q = q.eq("area_v2", areaV2);
      else if (regionV2 != null) q = q.eq("region_v2", regionV2);
      const { data, error } = await q.limit(600);
      if (error || !data) return [];
      return (data as Record<string, unknown>[]).map(rowToListing);
    },
  };
}

// Bảng tra tên địa phương -> mã, dựng từ chính dữ liệu đã crawl.
// Cached theo process để không query lại nhiều lần trong 1 request.
let areaCache: {
  areas: KnownArea[];
  codes: Map<string, { areaV2: number; areaName: string }>;
  regionCodes: Map<string, number>;
  at: number;
} | null = null;
const AREA_CACHE_TTL = 5 * 60 * 1000;

export async function refreshAreaIndex(admin: SupabaseClient): Promise<void> {
  const { data } = await admin
    .from("market_listings")
    .select("area_name,area_v2,region_name,region_v2")
    .not("area_name", "is", null)
    .not("area_v2", "is", null)
    .limit(2000);
  const areas: KnownArea[] = [];
  const codes = new Map<string, { areaV2: number; areaName: string }>();
  const regionCodes = new Map<string, number>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const areaName = str(r.area_name);
    const areaV2 = num(r.area_v2);
    const regionName = str(r.region_name);
    const regionV2 = num(r.region_v2);
    if (areaName && areaV2 != null) {
      areas.push({ name: areaName, isRegion: false });
      codes.set(`${areaName}|${regionName ?? ""}`, { areaV2, areaName });
    }
    if (regionName && regionV2 != null) {
      areas.push({ name: regionName, isRegion: true });
      regionCodes.set(regionName, regionV2);
    }
  }
  areaCache = { areas, codes, regionCodes, at: Date.now() };
}

function cacheValid(): boolean {
  return areaCache !== null && Date.now() - areaCache.at < AREA_CACHE_TTL;
}

export function knownAreas(): KnownArea[] {
  return cacheValid() ? areaCache!.areas : [];
}

function lookupAreaV2(areaName: string, regionName: string | null): { areaV2: number; areaName: string } | null {
  if (!cacheValid()) return null;
  return areaCache!.codes.get(`${areaName}|${regionName ?? ""}`) ?? null;
}

function lookupRegionV2(regionName: string): number | null {
  if (!cacheValid()) return null;
  return areaCache!.regionCodes.get(regionName) ?? null;
}

export function supabasePriceStats(admin: SupabaseClient): PriceStatsRepo {
  return {
    async get(scopeKey, statDate) {
      const { data } = await admin
        .from("market_price_stats")
        .select("*")
        .eq("scope_key", scopeKey)
        .eq("stat_date", statDate)
        .maybeSingle();
      if (!data) return null;
      const r = data as Record<string, unknown>;
      return {
        scope_key: String(r.scope_key),
        stat_date: String(r.stat_date),
        scope_level: r.scope_level as PriceScope["scope_level"],
        scope_description: String(r.scope_description ?? ""),
        region_name: str(r.region_name),
        area_name: str(r.area_name),
        category_code: num(r.category_code) ?? 0,
        size_min_m2: num(r.size_min_m2),
        size_max_m2: num(r.size_max_m2),
        rooms: num(r.rooms),
        sample_size: num(r.sample_size) ?? 0,
        trimmed_size: num(r.trimmed_size) ?? 0,
        excluded_promoted: num(r.excluded_promoted) ?? 0,
        excluded_invalid: num(r.excluded_invalid) ?? 0,
        p25_ppm2: num(r.p25_ppm2),
        median_ppm2: num(r.median_ppm2),
        p75_ppm2: num(r.p75_ppm2),
        min_ppm2: num(r.min_ppm2),
        max_ppm2: num(r.max_ppm2),
        quality_score: num(r.quality_score),
        source: String(r.source ?? "chotot_gateway"),
        computed_at: toIso(r.computed_at),
      };
    },

    async claim({ scopeKey, statDate, scope }) {
      // Khoá tự nhiên bằng PK (scope_key, stat_date): thắng thì được phép crawl.
      const { error } = await admin.from("market_price_stats").insert({
        scope_key: scopeKey,
        stat_date: statDate,
        scope_level: scope.scope_level,
        scope_description: scope.scope_description,
        region_name: scope.region_name,
        area_name: scope.area_name,
        category_code: scope.category_code,
        size_min_m2: scope.size_min_m2,
        size_max_m2: scope.size_max_m2,
        rooms: scope.rooms_min,
        sample_size: 0,
        trimmed_size: 0,
        excluded_promoted: 0,
        excluded_invalid: 0,
        source: "chotot_gateway",
      });
      if (!error) return true;
      // 23505 = unique violation -> người khác đang giữ khoá (scope_key,
      // stat_date). Đây là kết quả bình thường của cơ chế khoá, giữ trả false.
      if (error.code === "23505") return false;
      // Mọi lỗi còn lại là lỗi DB (23514 check, 42501 RLS, 42xxx, 5xxxx, ...),
      // KHÔNG phải "có người giữ khoá". Trả false ở đây biến hỏng schema thành
      // "chưa ai crawl" -> tầng quận rơi xuống tỉnh trong im lặng, đúng cái
      // lỗi mà migration 0017 sửa. Phải ném để route báo "tạm thời chưa khả
      // dụng" và log ra error_code thay vì âm thầm hạ chất lượng báo cáo.
      throw new PricePipelineError("stats_claim_failed", { cause: error });
    },

    /**
     * Bỏ dòng claim sau khi crawl hỏng. Chỉ xoá placeholder `sample_size=0`
     * mà chính lần claim này tạo ra — không đụng dòng đã có số thật.
     * Lỗi xoá bị nuốt: tầng trên vẫn phải ném lỗi gốc.
     */
    async releaseClaim(scopeKey, statDate) {
      try {
        await admin
          .from("market_price_stats")
          .delete()
          .eq("scope_key", scopeKey)
          .eq("stat_date", statDate)
          .eq("sample_size", 0);
      } catch {
        /* best effort */
      }
    },

    async upsert(row: PriceStatsRow) {
      const { error } = await admin
        .from("market_price_stats")
        .upsert(
          [
            {
              scope_key: row.scope_key,
              stat_date: row.stat_date,
              scope_level: row.scope_level,
              scope_description: row.scope_description,
              region_name: row.region_name,
              area_name: row.area_name,
              category_code: row.category_code,
              size_min_m2: row.size_min_m2,
              size_max_m2: row.size_max_m2,
              rooms: row.rooms,
              sample_size: row.sample_size,
              trimmed_size: row.trimmed_size,
              excluded_promoted: row.excluded_promoted,
              excluded_invalid: row.excluded_invalid,
              p25_ppm2: row.p25_ppm2,
              median_ppm2: row.median_ppm2,
              p75_ppm2: row.p75_ppm2,
              min_ppm2: row.min_ppm2,
              max_ppm2: row.max_ppm2,
              quality_score: row.quality_score,
              source: row.source,
              computed_at: row.computed_at,
            },
          ],
          { onConflict: "scope_key,stat_date" },
        );
      if (error) throw new PricePipelineError("stats_upsert_failed");
    },
  };
}

// Gazetteer tên địa danh -> mã (V2). Bảng geo_area_map KHÔNG có policy nào nên
// chỉ service role đọc/ghi được — đúng như 2 repo trên.
export function supabaseGeoAreaMap(admin: SupabaseClient): GeoAreaMapRepo {
  return {
    async find(regionKey, areaKey) {
      const { data, error } = await admin
        .from("geo_area_map")
        .select("region_name, area_name, region_v2, area_v2, ward_v2")
        .eq("region_name", regionKey)
        .eq("area_name", areaKey)
        .maybeSingle();
      if (error) throw new PricePipelineError("geo_map_read_failed");
      const r = data as Record<string, unknown> | null;
      const areaV2 = num(r?.area_v2);
      if (!r || areaV2 === null) return null;
      return {
        regionKey: str(r.region_name) ?? regionKey,
        areaKey: str(r.area_name) ?? areaKey,
        region_v2: num(r.region_v2),
        area_v2: areaV2,
        // Cột thêm ở migration 0016. Bảng cũ chưa migrate thì select sẽ lỗi và
        // tầng trên bắt rồi bỏ qua -> coi như cache miss, hỏng thì vẫn chạy được.
        ward_v2: num(r.ward_v2),
      };
    },

    async save(row) {
      const { error } = await admin.from("geo_area_map").upsert(
        {
          region_name: row.regionKey,
          area_name: row.areaKey,
          region_v2: row.region_v2,
          area_v2: row.area_v2,
          ward_v2: row.ward_v2,
          resolved_at: new Date().toISOString(),
        },
        { onConflict: "region_name,area_name" },
      );
      // Ném lỗi để geo-resolver bắt và bỏ qua: cache hỏng không được chặn pipeline.
      if (error) throw new PricePipelineError("geo_map_write_failed");
    },
  };
}
