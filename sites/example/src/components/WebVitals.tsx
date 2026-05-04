"use client";

import { useReportWebVitals } from "next/web-vitals";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

// Forward Core Web Vitals (LCP, INP, CLS, FCP, TTFB) to GA. The events
// flow through the same gtag pipe as everything else, so Consent Mode v2
// applies — when consent is denied (or GPC is on), they're sent as
// cookieless pings; when granted, they're attributed to the GA cookie.
export function WebVitals() {
  useReportWebVitals((metric) => {
    if (!GA_ID || typeof window === "undefined" || !window.gtag) return;
    window.gtag("event", metric.name, {
      event_category: "Web Vitals",
      value: Math.round(
        metric.name === "CLS" ? metric.value * 1000 : metric.value,
      ),
      metric_id: metric.id,
      metric_value: metric.value,
      metric_delta: metric.delta,
      metric_rating: metric.rating,
      non_interaction: true,
    });
  });
  return null;
}
