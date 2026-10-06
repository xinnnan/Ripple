import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  buildImageRemotePatterns,
  buildSecurityHeaderRules,
  resolveSupabaseOrigin,
} from "./security-headers";

const SUPABASE = "https://abcdefgh.supabase.co";

function directives(policy: string) {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values] as const;
      })
  );
}

function headersFor(source: string, isDevelopment = false) {
  const rule = buildSecurityHeaderRules({
    supabaseUrl: SUPABASE,
    isDevelopment,
  }).find((entry) => entry.source === source);
  expect(rule, `rule for ${source}`).toBeDefined();
  return new Map(rule!.headers.map(({ key, value }) => [key, value]));
}

describe("resolveSupabaseOrigin", () => {
  it("returns only the origin of a valid HTTP(S) project URL", () => {
    expect(resolveSupabaseOrigin(`${SUPABASE}/rest/v1/`)).toBe(SUPABASE);
    expect(resolveSupabaseOrigin("http://127.0.0.1:55321")).toBe(
      "http://127.0.0.1:55321"
    );
  });

  it.each([undefined, "", "not a url", "javascript:alert(1)", "ftp://x.co"])(
    "rejects unusable value %s",
    (value) => {
      expect(resolveSupabaseOrigin(value)).toBeNull();
    }
  );
});

describe("buildContentSecurityPolicy", () => {
  it("locks framing, plugins, base, and form targets", () => {
    const policy = directives(
      buildContentSecurityPolicy({ supabaseOrigin: SUPABASE, isDevelopment: false })
    );
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    expect(policy.has("upgrade-insecure-requests")).toBe(true);
  });

  it("allows browser auth traffic only to the configured Supabase project", () => {
    const policy = directives(
      buildContentSecurityPolicy({ supabaseOrigin: SUPABASE, isDevelopment: false })
    );
    expect(policy.get("connect-src")).toEqual([
      "'self'",
      SUPABASE,
      "wss://abcdefgh.supabase.co",
    ]);
    expect(policy.get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("permits eval and plain HTTP only for local development", () => {
    const policy = directives(
      buildContentSecurityPolicy({
        supabaseOrigin: "http://127.0.0.1:55321",
        isDevelopment: true,
      })
    );
    expect(policy.get("script-src")).toContain("'unsafe-eval'");
    expect(policy.get("connect-src")).toContain("ws://127.0.0.1:55321");
    expect(policy.has("upgrade-insecure-requests")).toBe(false);
  });

  it("falls back to same-origin connections without a valid project URL", () => {
    const policy = directives(
      buildContentSecurityPolicy({ supabaseOrigin: null, isDevelopment: false })
    );
    expect(policy.get("connect-src")).toEqual(["'self'"]);
  });
});

describe("buildSecurityHeaderRules", () => {
  it("applies baseline hardening headers to every route", () => {
    const headers = headersFor("/:path*");
    expect(headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'"
    );
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin"
    );
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains"
    );
  });

  it("omits HSTS in local development", () => {
    expect(headersFor("/:path*", true).has("Strict-Transport-Security")).toBe(
      false
    );
  });

  it("keeps token-bearing share links out of referrers and search indexes", () => {
    const headers = headersFor("/t/:path*");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive");
  });

  it("keeps API responses out of search indexes", () => {
    expect(headersFor("/api/:path*").get("X-Robots-Tag")).toBe(
      "noindex, nofollow"
    );
  });
});

describe("buildImageRemotePatterns", () => {
  it("allows only public storage objects from the configured project", () => {
    expect(buildImageRemotePatterns(SUPABASE)).toEqual([
      {
        protocol: "https",
        hostname: "abcdefgh.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/**",
      },
    ]);
  });

  it("allows no remote images without a valid project URL", () => {
    expect(buildImageRemotePatterns(undefined)).toEqual([]);
  });
});
