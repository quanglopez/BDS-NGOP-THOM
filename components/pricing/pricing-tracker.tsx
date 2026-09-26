"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

export function PricingTracker() {
  useEffect(() => {
    trackEvent("pricing_viewed", { path: "/pricing" });
  }, []);
  return null;
}
