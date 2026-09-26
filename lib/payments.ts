// Cấu hình thanh toán VietQR / SePay + giá gói

export const PLANS = {
  free: { label: "Free", price: 0, dailyLimit: 20 },
  pro: { label: "Pro", price: 299000, dailyLimit: 500 },
  team: { label: "Team", price: 799000, dailyLimit: 500 },
} as const;

export type PlanKey = keyof typeof PLANS;

// Gói dài hạn cho Pro. Chiết khấu là thật (tổng tiền thấp hơn mua lẻ từng tháng),
// admin chỉnh giá bằng cách sửa PLANS.pro.price — mọi giá tự tính lại theo.
export interface DurationOption {
  months: number;
  label: string;
  discount: number; // 0.1 = giảm 10%
  badge?: string;
}

export const DURATIONS: DurationOption[] = [
  { months: 1, label: "1 tháng", discount: 0 },
  { months: 2, label: "2 tháng", discount: 0.05 },
  { months: 3, label: "3 tháng", discount: 0.1, badge: "Phổ biến nhất" },
  { months: 6, label: "6 tháng", discount: 0.15 },
  { months: 12, label: "1 năm", discount: 0.2, badge: "Tiết kiệm nhất" },
];

export interface PriceQuote {
  months: number;
  total: number; // tổng phải trả
  perMonth: number; // quy ra mỗi tháng
  fullPrice: number; // giá gốc (mua lẻ từng tháng)
  saved: number; // số tiền tiết kiệm
}

// Tính giá theo số tháng, làm tròn nghìn cho dễ chuyển khoản
export function quotePrice(months: number): PriceQuote {
  const d = DURATIONS.find((x) => x.months === months) ?? DURATIONS[0];
  const fullPrice = PLANS.pro.price * d.months;
  const total = Math.round((fullPrice * (1 - d.discount)) / 1000) * 1000;
  return {
    months: d.months,
    total,
    perMonth: Math.round(total / d.months),
    fullPrice,
    saved: fullPrice - total,
  };
}

// Nội dung chuyển khoản: NANGCAP {user_id} [T{tháng}] -> webhook tự nhận diện.
// Gói 1 tháng giữ nguyên định dạng cũ để không lẫn với giao dịch đang chờ.
export function transferContent(userId: string, months = 1): string {
  return months > 1 ? `NANGCAP ${userId} T${months}` : `NANGCAP ${userId}`;
}

// Sinh ảnh QR VietQR (img.vietqr.io - không cần key)
export function vietQrImageUrl(amount: number, content: string): string {
  const bank = process.env.NEXT_PUBLIC_SEPAY_BANK ?? "";
  const account = process.env.NEXT_PUBLIC_SEPAY_ACCOUNT ?? "";
  if (!bank || !account) return "";
  return `https://img.vietqr.io/image/${bank}-${account}-qr_only.png?amount=${amount}&addInfo=${encodeURIComponent(content)}`;
}

// Trích mã tài khoản từ nội dung CK ngân hàng trả về.
// Ngân hàng thường bỏ dấu gạch của UUID (NANGCAP d7d8a114c5fc... thay vì
// NANGCAP d7d8a114-c5fc-...) và chèn thêm mã giao dịch phía trước, nên phải
// chấp nhận cả 2 dạng rồi chuẩn hoá về UUID có gạch.
export function parseUserIdFromContent(content: string): string | null {
  const m = content.match(/NANGCAP\s+([0-9a-fA-F-]{20,40})/);
  if (!m) return null;
  const hex = m[1].replace(/-/g, "").toLowerCase();
  if (hex.length !== 32) return null;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

// Số tháng mua từ nội dung CK (NANGCAP {uuid} T12). Không có -> 1 tháng.
export function parseMonthsFromContent(content: string): number {
  const m = content.match(/\bT(\d{1,2})\b/);
  const n = m ? Number(m[1]) : 1;
  return n >= 1 && n <= 24 ? n : 1;
}

// Gói suy ra từ số tiền chuyển khoản (đường cũ, khi nội dung CK không có số tháng)
export function planFromAmount(amount: number): PlanKey | null {
  if (amount >= PLANS.team.price) return "team";
  if (amount >= PLANS.pro.price) return "pro";
  return null;
}
