/**
 * HTTP hardening for every response. Kept dependency-free so `next.config.ts`
 * can import it at build time.
 *
 * The App Router injects inline bootstrap scripts without nonces unless every
 * route runs through nonce-issuing middleware, so `script-src` keeps
 * 'unsafe-inline'. The policy still blocks framing, plugins, base-tag
 * hijacking, cross-origin form posts, and browser connections to anything
 * other than this app and its own Supabase project.
 */

interface PolicyOptions {
  supabaseOrigin: string | null;
  isDevelopment: boolean;
}

interface HeaderRuleOptions {
  supabaseUrl: string | undefined;
  isDevelopment: boolean;
}

export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

export interface ImageRemotePattern {
  protocol: "http" | "https";
  hostname: string;
  port: string;
  pathname: string;
}

export function resolveSupabaseOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function websocketOrigin(origin: string): string {
  return origin.replace(/^http/, "ws");
}

export function buildContentSecurityPolicy({
  supabaseOrigin,
  isDevelopment,
}: PolicyOptions): string {
  const connect = ["'self'"];
  if (supabaseOrigin) connect.push(supabaseOrigin, websocketOrigin(supabaseOrigin));

  const script = ["'self'", "'unsafe-inline'"];
  if (isDevelopment) script.push("'unsafe-eval'");

  const directives = [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (!isDevelopment) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export function buildSecurityHeaderRules({
  supabaseUrl,
  isDevelopment,
}: HeaderRuleOptions): HeaderRule[] {
  const baseline = [
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy({
        supabaseOrigin: resolveSupabaseOrigin(supabaseUrl),
        isDevelopment,
      }),
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  if (!isDevelopment) {
    baseline.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    });
  }

  return [
    { source: "/:path*", headers: baseline },
    {
      // Share links carry a bearer token in the query string.
      source: "/t/:path*",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ],
    },
    {
      source: "/api/:path*",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    },
  ];
}

/**
 * Only this project's public storage objects may pass through the image
 * optimizer; a wildcard Supabase host would proxy any project's files.
 */
export function buildImageRemotePatterns(
  supabaseUrl: string | undefined
): ImageRemotePattern[] {
  const origin = resolveSupabaseOrigin(supabaseUrl);
  if (!origin) return [];
  const parsed = new URL(origin);
  return [
    {
      protocol: parsed.protocol === "http:" ? "http" : "https",
      hostname: parsed.hostname,
      port: parsed.port,
      pathname: "/storage/v1/object/public/**",
    },
  ];
}
