// Cấu hình thanh toán VietQR / SePay + giá gói

export const PLANS = {
  free: { label: "Free", price: 0, dailyLimit: 20 },
  pro: { label: "Pro", price: 299000, dailyLimit: 500 },
  team: { label: "Team", price: 799000, dailyLimit: 500 },
} as const;

export type PlanKey = keyof typeof PLANS;

// Nội dung chuyển khoản: NANGCAP {user_id} -> webhook tự nhận diện
export function transferContent(userId: string): string {
  return `NANGCAP ${userId}`;
}

// Sinh ảnh QR VietQR (img.vietqr.io - không cần key)
export function vietQrImageUrl(amount: number, content: string): string {
  const bank = process.env.NEXT_PUBLIC_SEPAY_BANK ?? "";
  const account = process.env.NEXT_PUBLIC_SEPAY_ACCOUNT ?? "";
  if (!bank || !account) return "";
  return `https://img.vietqr.io/image/${bank}-${account}-qr_only.png?amount=${amount}&addInfo=${encodeURIComponent(content)}`;
}

// Gói suy ra từ số tiền chuyển khoản
export function planFromAmount(amount: number): PlanKey | null {
  if (amount >= PLANS.team.price) return "team";
  if (amount >= PLANS.pro.price) return "pro";
  return null;
}
