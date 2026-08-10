import type { MetadataRoute } from "next";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://platform.blissmedialab.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/dashboard/",
          "/api/",
          "/portal/",
          "/pending-approval",
          "/reset-password",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}