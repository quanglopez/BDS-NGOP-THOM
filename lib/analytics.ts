// Ghi sự kiện phễu chuyển đổi. Không thêm dependency ngoài:
// - Có Google Tag Manager (window.dataLayer) -> đẩy vào dataLayer
// - Có GA4 (window.gtag) -> gọi gtag
// - Không có gì -> no-op (dev thì log)

export type FunnelEvent =
  | "homepage_view"
  | "demo_started"
  | "property_checked"
  | "login_clicked"
  | "login_completed"
  | "free_limit_reached"
  | "pricing_viewed"
  | "upgrade_clicked"
  | "checkout_started"
  | "payment_completed";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackEvent(event: FunnelEvent, props: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  try {
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event, ...props });
    }
    if (typeof window.gtag === "function") {
      window.gtag("event", event, props);
    }
    if (process.env.NODE_ENV === "development") {
      console.info("[analytics]", event, props);
    }
  } catch {
    // đo lường không bao giờ được làm hỏng luồng chính
  }
}
