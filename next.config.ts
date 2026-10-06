import type { NextConfig } from "next";
import {
  buildImageRemotePatterns,
  buildSecurityHeaderRules,
} from "./src/lib/security-headers";

const isDevelopment = process.env.NODE_ENV !== "production";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: buildImageRemotePatterns(supabaseUrl),
  },
  async redirects() {
    // Operations moved out of the admin-only section so engineers can use it.
    return [
      {
        source: "/admin/field-service/:path*",
        destination: "/field-service/:path*",
        permanent: true,
      },
      {
        source: "/admin/part-requests/:path*",
        destination: "/part-requests/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return buildSecurityHeaderRules({ supabaseUrl, isDevelopment });
  },
};

export default nextConfig;
