import type { MetadataRoute } from "next";

// robots.txt cho SEO - domain lấy từ env NEXT_PUBLIC_SITE_URL
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://check-bds-ngop.vercel.app").replace(/\/$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/api/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
