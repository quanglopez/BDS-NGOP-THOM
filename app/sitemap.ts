import type { MetadataRoute } from "next";

// Sitemap cho SEO - domain lấy từ env NEXT_PUBLIC_SITE_URL
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://checkbds.online").replace(/\/$/, "");
  const now = new Date();

  return [
    { url: base, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/lien-he`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/dieu-khoan`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/bao-mat`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/hoan-tien`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
