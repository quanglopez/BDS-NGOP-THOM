// Ghi địa lý (ward/region) cho 1 lần check, TÁCH khỏi insert chính.
//
// Vì sao tách: bảng checks có policy select + insert nhưng KHÔNG có update policy,
// nên bước ghi địa lý phải đi qua service role. Nếu gộp vào insert chính và cột
// chưa tồn tại (thiếu migration) thì TOÀN BỘ check mới sẽ lỗi — flow cũ bị phá
// vì một feature mới. Tách ra thì thiếu cột chỉ mất dữ liệu địa lý, không mất check.
//
// Hàm này KHÔNG BAO GIỜ throw: caller chỉ cần biết ok/không.

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeErrorCode } from "@/lib/price/errors";

export type GeoSource = "scan" | "url" | null;

export interface CheckGeo {
  ward_name: string | null;
  region_name: string | null;
  ward_source: GeoSource;
  region_source: GeoSource;
}

export type GeoPersistResult =
  | { ok: true; skipped: boolean }
  | { ok: false; errorCode: string };

/** Không có địa lý thì không gọi DB — tránh log warning vô ích. */
export function hasCheckGeo(geo: CheckGeo): boolean {
  return Boolean(geo.ward_name || geo.region_name);
}

/**
 * Ghi 4 cột geo. Trả về kết quả thay vì ném lỗi.
 * - Cột chưa có (thiếu 0014) -> ok:false, errorCode "schema_missing"
 * - RLS / quyền -> ok:false, errorCode tương ứng
 * - Không có geo -> ok:true, skipped:true, KHÔNG gọi DB
 */
export async function persistCheckGeo(
  admin: SupabaseClient,
  checkId: string,
  geo: CheckGeo,
): Promise<GeoPersistResult> {
  if (!hasCheckGeo(geo)) return { ok: true, skipped: true };
  try {
    const { error } = await admin
      .from("checks")
      .update({
        ward_name: geo.ward_name,
        region_name: geo.region_name,
        ward_source: geo.ward_source,
        region_source: geo.region_source,
      })
      .eq("id", checkId);
    if (error) return { ok: false, errorCode: safeErrorCode(error) };
    return { ok: true, skipped: false };
  } catch (e) {
    return { ok: false, errorCode: safeErrorCode(e) };
  }
}
