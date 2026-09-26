// Thống kê cho trang admin — hàm thuần, không phụ thuộc Supabase nên test được.

export interface DayCount {
  date: string; // YYYY-MM-DD (giờ VN)
  count: number;
}

// Đếm số dòng theo ngày trong N ngày gần nhất (thiếu ngày -> count 0)
export function countByDay(
  rows: { created_at: string }[],
  days: number,
  now: Date = new Date(),
): DayCount[] {
  // Múi giờ VN: cộng 7h trước khi cắt ngày
  const vnOf = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  const todayVN = new Date(now.getTime() + 7 * 3600 * 1000);

  const map = new Map<string, number>();
  for (const r of rows) {
    const d = vnOf(r.created_at);
    const key = d.toISOString().slice(0, 10);
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  const out: DayCount[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayVN);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: map.get(key) ?? 0 });
  }
  return out;
}

// Đếm top N giá trị xuất hiện nhiều nhất (bỏ giá trị rỗng)
export function topCounts(values: (string | null | undefined)[], n = 5): { label: string; count: number }[] {
  const map = new Map<string, number>();
  for (const v of values) {
    const k = (v ?? "").trim();
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, n);
}

// Tên miền của link tin (bỏ www) — không có link thì null
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Tỉ lệ kèo ngon (điểm từ 80 trở lên), làm tròn 1 chữ số thập phân
export function goodDealRate(rows: { score: number | null }[]): number {
  if (rows.length === 0) return 0;
  const good = rows.filter((r) => (r.score ?? 0) >= 80).length;
  return Math.round((good / rows.length) * 1000) / 10;
}
