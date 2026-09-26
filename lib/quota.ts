// Giới hạn lượt check theo gói + helper ngày theo giờ Việt Nam (UTC+7)

export const PLAN_LIMITS: Record<string, number> = {
  free: 20,
  pro: 500,
  team: 500,
};

// Số tin tối đa trả về cho 1 lần quét trang danh mục (khớp số liệu trên pricing)
export const SCAN_LIMITS: Record<string, number> = {
  free: 10,
  pro: 50,
  team: 50,
};

export function scanLimit(plan: string | null | undefined): number {
  return SCAN_LIMITS[plan ?? "free"] ?? SCAN_LIMITS.free;
}

// 30 ngày mỗi lần thanh toán (1 tháng)
export const SUBSCRIPTION_DAYS = 30;

export function planLimit(plan: string | null | undefined): number {
  return PLAN_LIMITS[plan ?? "free"] ?? PLAN_LIMITS.free;
}

// Gói còn hiệu lực hay đã hết hạn: hết hạn thì coi như Free
export function effectivePlan(
  plan: string | null | undefined,
  planExpiresAt: string | null | undefined,
): string {
  if (!plan || plan === "free") return "free";
  if (!planExpiresAt) return "free";
  return new Date(planExpiresAt).getTime() > Date.now() ? plan : "free";
}

// Ngày hết hạn mới khi gia hạn: cộng dồn vào ngày đang có, không cộng vào ngày đã qua.
// months > 1 cho gói mua nhiều tháng (mỗi tháng 30 ngày).
export function nextExpiry(currentExpiry: string | null | undefined, months = 1): string {
  const base =
    currentExpiry && new Date(currentExpiry).getTime() > Date.now()
      ? new Date(currentExpiry)
      : new Date();
  const n = Math.max(1, Math.floor(months));
  base.setDate(base.getDate() + SUBSCRIPTION_DAYS * n);
  return base.toISOString();
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
