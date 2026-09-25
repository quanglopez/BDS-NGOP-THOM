import type { MetadataRoute } from "next";

// robots.txt cho SEO
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/api/"],
      },
    ],
    sitemap: "https://check-bds-ngop.vercel.app/sitemap.xml",
  };
}
