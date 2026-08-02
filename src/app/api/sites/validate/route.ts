import { NextRequest, NextResponse } from "next/server";
import {
  buildRateLimitBucketKey,
  consumeDistributedRateLimit,
  getRetryAfterSeconds,
} from "@/lib/distributed-rate-limit";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import {
  isValidSiteCode,
  normalizeSiteCode,
} from "@/lib/sites/site-code";
import { createAdminClient } from "@/lib/supabase/admin";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const VALIDATION_LIMIT = 20;
const VALIDATION_WINDOW_MS = 60_000;

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers },
  });
}

function invalidSiteCodeResponse() {
  return json({ valid: false });
}

function throttledResponse(retryAfter: number) {
  return json(
    { error: "Too many site-code checks. Please try again in a minute." },
    429,
    { "Retry-After": String(retryAfter) }
  );
}

export async function GET(request: NextRequest) {
  const rawSiteCode = request.nextUrl.searchParams.get("site_code");
  const clientIp = getClientIp(request.headers);
  const localLimit = rateLimit({
    key: `site-validate:${clientIp}`,
    limit: VALIDATION_LIMIT,
    windowMs: VALIDATION_WINDOW_MS,
  });
  if (!localLimit.allowed) {
    return throttledResponse(
      Math.max(1, Math.ceil((localLimit.resetAt - Date.now()) / 1000))
    );
  }
  if (!rawSiteCode || !isValidSiteCode(rawSiteCode)) {
    return invalidSiteCodeResponse();
  }

  const supabase = createAdminClient();
  try {
    const distributedLimit = await consumeDistributedRateLimit({
      supabase,
      bucketKey: buildRateLimitBucketKey("site-validate", clientIp),
      limit: VALIDATION_LIMIT,
      windowSeconds: VALIDATION_WINDOW_MS / 1000,
    });
    if (!distributedLimit.allowed) {
      return throttledResponse(
        getRetryAfterSeconds(distributedLimit.resetAt)
      );
    }

    const normalizedSiteCode = normalizeSiteCode(rawSiteCode);
    const { data: site, error } = await supabase
      .from("sites")
      .select("site_name, site_code, customer:customers!inner(status)")
      .eq("site_code", normalizedSiteCode)
      .eq("status", "active")
      .in("customer.status", ["active", "trial"])
      .maybeSingle();

    if (error) {
      console.error("GET /api/sites/validate lookup failed:", {
        code: error.code,
      });
      return json({ error: "Site validation is temporarily unavailable" }, 503);
    }
    if (!site) {
      return invalidSiteCodeResponse();
    }

    return json({
      valid: true,
      site: {
        site_name: site.site_name,
        site_code: site.site_code,
      },
    });
  } catch (error) {
    console.error("GET /api/sites/validate unavailable:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "Site validation is temporarily unavailable" }, 503);
  }
}
