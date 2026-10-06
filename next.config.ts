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
  async headers() {
    return buildSecurityHeaderRules({ supabaseUrl, isDevelopment });
  },
};

export default nextConfig;
