"use client";

import Script from "next/script";

// Nạp Google Analytics 4. Measurement ID lấy từ env NEXT_PUBLIC_GA_MEASUREMENT_ID.
// Chưa có ID (chưa cấu hình) -> không nạp gì cả, app chạy bình thường,
// các trackEvent() trong lib/analytics vẫn no-op an toàn.
export function Ga4() {
  const id = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  if (!id) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${id}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${id}');
        `}
      </Script>
    </>
  );
}
