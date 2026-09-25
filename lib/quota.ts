// Giới hạn lượt check theo gói + helper ngày theo giờ Việt Nam (UTC+7)

export const PLAN_LIMITS: Record<string, number> = {
  free: 20,
  pro: 500,
  team: 500,
};

export function planLimit(plan: string | null | undefined): number {
  return PLAN_LIMITS[plan ?? "free"] ?? PLAN_LIMITS.free;
}

// ISO của 00:00 hôm nay theo giờ VN
export function vnDayStartISO(): string {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 3600 * 1000);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth();
  const d = vn.getUTCDate();
  return new Date(Date.UTC(y, m, d) - 7 * 3600 * 1000).toISOString();
}
