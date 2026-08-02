import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/046_durable_public_rate_limits.sql"
  ),
  "utf8"
);
const siteValidationRoute = readFileSync(
  join(process.cwd(), "src/app/api/sites/validate/route.ts"),
  "utf8"
);
const ticketRoute = readFileSync(
  join(process.cwd(), "src/app/api/tickets/route.ts"),
  "utf8"
);

describe("migration 046 durable public rate limits", () => {
  it("stores only opaque bounded bucket keys with expiry indexing", () => {
    expect(sql).toContain("CREATE TABLE public.request_rate_limits");
    expect(sql).toContain("CHECK (bucket_key ~ '^[0-9a-f]{64}$')");
    expect(sql).toContain("request_rate_limits_reset_at_idx");
  });

  it("atomically consumes and resets buckets under conflict", () => {
    expect(sql).toContain("ON CONFLICT (bucket_key) DO UPDATE");
    expect(sql).toContain("WHEN bucket.reset_at <= v_now THEN 1");
    expect(sql).toContain("LEAST(bucket.request_count + 1, p_limit + 1)");
  });

  it("bounds command inputs and retained state", () => {
    expect(sql).toContain("p_limit NOT BETWEEN 1 AND 10000");
    expect(sql).toContain("p_window_seconds NOT BETWEEN 1 AND 86400");
    expect(sql).toContain("LIMIT 100");
    expect(sql).toContain("interval '24 hours'");
  });

  it("keeps table and command inaccessible to public API roles", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.request_rate_limits\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.consume_request_rate_limit\(text, integer, integer\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.consume_request_rate_limit\(text, integer, integer\)\s+TO service_role;/
    );
  });

  it("runs the command with a fixed empty search path", () => {
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = ''");
  });

  it("enforces durable limits on both public enumeration and submission", () => {
    expect(siteValidationRoute).toContain(
      'buildRateLimitBucketKey("site-validate", clientIp)'
    );
    expect(siteValidationRoute).toContain("consumeDistributedRateLimit({");
    expect(ticketRoute).toContain(
      'buildRateLimitBucketKey("ticket-submit", ip)'
    );
    expect(ticketRoute).toContain("consumeDistributedRateLimit({");
  });
});
