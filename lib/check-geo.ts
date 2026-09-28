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
 *
 * KHÔNG GHI ĐÈ: chỉ điền vào cột đang NULL. Một check đã có địa lý thì giữ nguyên
 * — lịch sử phải bất biến (xem app/api/price-intelligence/route.ts). Vì vậy phải
 * đọc trước rồi mới biết ô nào còn trống; điều kiện .or() ở bước ghi chỉ là lớp
 * phòng thủ thứ hai cho trường hợp hai request chạy song song.
 */
export async function persistCheckGeo(
  admin: SupabaseClient,
  checkId: string,
  geo: CheckGeo,
): Promise<GeoPersistResult> {
  if (!hasCheckGeo(geo)) return { ok: true, skipped: true };
  try {
    // 1) Đọc geo hiện có (chỉ 2 cột) để biết ô nào còn trống.
    const { data: current, error: readError } = await admin
      .from("checks")
      .select("ward_name, region_name")
      .eq("id", checkId)
      .maybeSingle();
    if (readError) return { ok: false, errorCode: safeErrorCode(readError) };

    const existing = (current ?? {}) as { ward_name?: string | null; region_name?: string | null };
    const patch: Record<string, string | null> = {};
    // Chỉ điền ô trống, và luôn ghi kèm cột nguồn tương ứng.
    if (existing.ward_name == null && geo.ward_name) {
      patch.ward_name = geo.ward_name;
      patch.ward_source = geo.ward_source;
    }
    if (existing.region_name == null && geo.region_name) {
      patch.region_name = geo.region_name;
      patch.region_source = geo.region_source;
    }
    // Đã đầy địa lý -> không ghi gì cả.
    if (Object.keys(patch).length === 0) return { ok: true, skipped: true };

    // 2) Ghi phần còn thiếu, kèm điều kiện chống ghi đè ở mức dòng.
    const { error } = await admin
      .from("checks")
      .update(patch)
      .eq("id", checkId)
      .or("ward_name.is.null,region_name.is.null");
    if (error) return { ok: false, errorCode: safeErrorCode(error) };
    return { ok: true, skipped: false };
  } catch (e) {
    return { ok: false, errorCode: safeErrorCode(e) };
  }
}
