import type { MetadataRoute } from "next";

/**
 * Only the marketing page and guest intake are public content. Share links
 * (`/t/…?token=`) are bearer credentials and also send `X-Robots-Tag`.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/submit"],
        disallow: [
          "/api/",
          "/t/",
          "/auth/",
          "/dashboard",
          "/tickets",
          "/sites",
          "/team",
          "/profile",
          "/settings",
          "/admin",
          "/field-service",
          "/part-requests",
          "/reset-password",
        ],
      },
    ],
  };
}
