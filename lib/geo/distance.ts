// Khoảng cách địa lý — chỉ dùng để sắp xếp/hiển thị comparable.
// Thiếu tọa độ ở một đầu thì trả null (UI hiện "Cùng phường"/"Cùng khu vực"),
// KHÔNG đoán và KHÔNG gán 0 (0 km là khẳng định sai).

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine. Trả null nếu thiếu tọa độ ở bất kỳ đầu nào.
 * Khoảng cách chỉ là ước lượng để sắp xếp, không dùng để kết luận.
 */
export function haversineKm(
  aLat: number | null,
  aLng: number | null,
  bLat: number | null,
  bLng: number | null,
): number | null {
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null;
  if (![aLat, aLng, bLat, bLng].every((v) => Number.isFinite(v))) return null;
  // Chặn tọa độ (0,0) — thường là dữ liệu thiếu bị gán 0
  if (aLat === 0 && aLng === 0) return null;
  if (bLat === 0 && bLng === 0) return null;

  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  const km = 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
  return Math.round(km * 10) / 10;
}
