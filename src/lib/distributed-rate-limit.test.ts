import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildRateLimitBucketKey,
  consumeDistributedRateLimit,
  DistributedRateLimitError,
  getRetryAfterSeconds,
} from "./distributed-rate-limit";

function clientWithResult(result: unknown) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("distributed rate limiting", () => {
  it("builds stable opaque keys without retaining the identifier", () => {
    const identifier = "203.0.113.8";
    const key = buildRateLimitBucketKey("site-validate", identifier);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain(identifier);
    expect(buildRateLimitBucketKey("site-validate", identifier)).toBe(key);
    expect(buildRateLimitBucketKey("ticket-submit", identifier)).not.toBe(key);
  });

  it("uses one conservative bucket for blank identifiers", () => {
    expect(buildRateLimitBucketKey("site-validate", "   ")).toBe(
      buildRateLimitBucketKey("site-validate", "unknown")
    );
  });

  it("rejects invalid purpose names", () => {
    expect(() => buildRateLimitBucketKey("Site Validate!", "client")).toThrow(
      DistributedRateLimitError
    );
  });

  it("calls the atomic command and parses its table result", async () => {
    const resetAt = "2026-08-01T12:01:00.000Z";
    const { client, rpc } = clientWithResult({
      data: [{ allowed: true, remaining: 19, reset_at: resetAt }],
      error: null,
    });

    await expect(
      consumeDistributedRateLimit({
        supabase: client,
        bucketKey: "a".repeat(64),
        limit: 20,
        windowSeconds: 60,
      })
    ).resolves.toEqual({ allowed: true, remaining: 19, resetAt });
    expect(rpc).toHaveBeenCalledWith("consume_request_rate_limit", {
      p_bucket_key: "a".repeat(64),
      p_limit: 20,
      p_window_seconds: 60,
    });
  });

  it("fails closed when the command errors", async () => {
    const { client } = clientWithResult({
      data: null,
      error: { code: "42883", message: "private detail" },
    });

    await expect(
      consumeDistributedRateLimit({
        supabase: client,
        bucketKey: "b".repeat(64),
        limit: 20,
        windowSeconds: 60,
      })
    ).rejects.toThrow("Distributed rate-limit command failed");
  });

  it("fails closed on malformed command output", async () => {
    const { client } = clientWithResult({
      data: [{ allowed: "yes", remaining: -1, reset_at: "never" }],
      error: null,
    });

    await expect(
      consumeDistributedRateLimit({
        supabase: client,
        bucketKey: "c".repeat(64),
        limit: 20,
        windowSeconds: 60,
      })
    ).rejects.toThrow("invalid result");
  });

  it("returns a positive Retry-After even at the reset boundary", () => {
    expect(
      getRetryAfterSeconds("2026-08-01T12:01:00.000Z", Date.parse("2026-08-01T12:00:30.100Z"))
    ).toBe(30);
    expect(
      getRetryAfterSeconds("2026-08-01T12:00:00.000Z", Date.parse("2026-08-01T12:00:01.000Z"))
    ).toBe(1);
  });
});
