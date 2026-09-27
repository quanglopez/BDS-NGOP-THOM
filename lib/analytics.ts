// Ghi sự kiện phễu chuyển đổi. Không thêm dependency ngoài:
// - Có Google Tag Manager (window.dataLayer) -> đẩy vào dataLayer
// - Có GA4 (window.gtag) -> gọi gtag
// - Không có gì -> no-op (dev thì log)

export type FunnelEvent =
  | "homepage_view"
  | "input_started"
  | "cta_clicked"
  | "demo_started"
  | "property_checked"
  | "login_clicked"
  | "login_completed"
  | "free_limit_reached"
  | "pricing_viewed"
  | "upgrade_clicked"
  | "checkout_started"
  | "payment_completed"
  | "pro_analysis_view"
  | "score_breakdown_view"
  | "red_flag_view"
  | "price_intelligence_view"
  | "pro_locked_section_view"
  | "pro_unlock_click"
  | "upgrade_from_report_click";

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
