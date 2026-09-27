// Pending report: report khách check khi CHƯA login.
// Trước khi đá sang /login, lưu dữ liệu vào sessionStorage + quay lại đúng
// report sau login (re-run với session thật, không bắt nhập lại).
// Dùng sessionStorage (không phải localStorage): đóng tab là mất, tránh rò
// rỉ nội dung tin nhạy cảm. Không lưu trong DB vì user chưa có tài khoản.

export interface PendingReport {
  text: string;
  listingUrl: string | null;
  // URL trang khách đang đứng (có hash #kiem-tra để scroll đúng chỗ)
  returnTo: string;
}

const KEY = "checkbds:pending-report";

export function savePendingReport(report: PendingReport): void {
  try {
    if (typeof window === "undefined") return;
    const payload = {
      text: (report.text ?? "").slice(0, 1000),
      listingUrl: report.listingUrl ?? null,
      returnTo: report.returnTo || "/#kiem-tra",
    };
    if (!payload.text.trim()) return;
    window.sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Ghi không được thì login vẫn đi tiếp, chỉ mất khôi phục
  }
}

// Đọc 1 lần rồi xoá ngay (tiêu thụ 1 lần) — tránh restore lặp ở lần sau
export function takePendingReport(): PendingReport | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as Partial<PendingReport>;
    if (typeof parsed.text !== "string" || !parsed.text.trim()) return null;
    return {
      text: parsed.text.slice(0, 1000),
      listingUrl: typeof parsed.listingUrl === "string" ? parsed.listingUrl : null,
      returnTo: typeof parsed.returnTo === "string" && parsed.returnTo.startsWith("/") ? parsed.returnTo : "/#kiem-tra",
    };
  } catch {
    return null;
  }
}

export function clearPendingReport(): void {
  try {
    window.sessionStorage?.removeItem(KEY);
  } catch {
    // bỏ qua
  }
}
