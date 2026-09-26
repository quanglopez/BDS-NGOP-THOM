// Trích thông tin cơ bản từ text tin rao (phần chưa có trong /api/check).
// Hiện chỉ cần số phòng ngủ — giá và diện tích đã trích sẵn ở route check.

// "3 phòng ngủ", "3 pn", "4 ngủ", "3ngủ" -> 3. Không nhầm "3 nhà vệ sinh", "3 tầng".
export function extractBedrooms(text: string): number | null {
  if (!text) return null;
  const m = text.match(/(?:^|[^\d])(\d{1,2})\s*(?:phòng ngủ|phong ngu|pn|ngủ|ngu)(?!\p{L})/iu);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 20 ? n : null;
}
