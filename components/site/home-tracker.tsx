"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

// Ghi sự kiện homepage_view một lần khi khách vào trang chủ
export function HomePageTracker() {
  useEffect(() => {
    trackEvent("homepage_view", { path: "/" });
  }, []);
  return null;
}
