// Trích số điện thoại liên hệ từ nội dung tin rao (text người dùng dán hoặc lấy từ link).
// Định dạng Việt Nam: 0xxxxxxxxx, 0xx xxx xxxx, 09xx.xxx.xxx, +84xxxxxxxxx, 84xxxxxxxxx.

// Các đầu số di động VN hợp lệ hiện hành
const VN_PREFIX = /^(03|05|07|08|09)/;

// Tách mọi "chuỗi giống SĐT" trong text (có thể chấm/gạch/khoảng trắng xen giữa)
const PHONE_LIKE = /(?:\+?84|0)(?:[\s.\-()]?\d){8,11}(?!\d)/g;

export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("84")) d = "0" + d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  if (d.length === 11 && d.startsWith("0")) return null;
  if (!VN_PREFIX.test(d)) return null;
  return d;
}

// Trả về SĐT đầu tiên tìm được trong text (đã chuẩn hóa), không có -> null
export function extractPhone(text: string): string | null {
  if (!text) return null;
  const matches = text.match(PHONE_LIKE) ?? [];
  for (const m of matches) {
    const p = normalizePhone(m);
    if (p) return p;
  }
  return null;
}

// Định dạng 0909 123 456 để dễ đọc
export function formatPhone(phone: string | null): string {
  if (!phone) return "";
  if (phone.length === 10 && phone.startsWith("0")) {
    return `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`;
  }
  return phone;
}
