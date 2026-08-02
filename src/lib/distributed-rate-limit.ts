import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DistributedRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: string;
}

export class DistributedRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DistributedRateLimitError";
  }
}

export function buildRateLimitBucketKey(
  purpose: string,
  identifier: string
): string {
  if (!/^[a-z0-9-]{1,40}$/.test(purpose)) {
    throw new DistributedRateLimitError("Rate-limit purpose is invalid");
  }

  const normalizedIdentifier = identifier.trim() || "unknown";
  return createHash("sha256")
    .update(`ripple-rate-limit:v1:${purpose}:${normalizedIdentifier}`)
    .digest("hex");
}

export async function consumeDistributedRateLimit(args: {
  supabase: SupabaseClient;
  bucketKey: string;
  limit: number;
  windowSeconds: number;
}): Promise<DistributedRateLimitResult> {
  const { data, error } = await args.supabase.rpc("consume_request_rate_limit", {
    p_bucket_key: args.bucketKey,
    p_limit: args.limit,
    p_window_seconds: args.windowSeconds,
  });

  if (error) {
    throw new DistributedRateLimitError(
      "Distributed rate-limit command failed"
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { allowed?: unknown; remaining?: unknown; reset_at?: unknown }
    | null;
  if (
    !row ||
    typeof row.allowed !== "boolean" ||
    typeof row.remaining !== "number" ||
    !Number.isInteger(row.remaining) ||
    row.remaining < 0 ||
    typeof row.reset_at !== "string" ||
    !Number.isFinite(Date.parse(row.reset_at))
  ) {
    throw new DistributedRateLimitError(
      "Distributed rate-limit command returned an invalid result"
    );
  }

  return {
    allowed: row.allowed,
    remaining: row.remaining,
    resetAt: row.reset_at,
  };
}

export function getRetryAfterSeconds(resetAt: string, now = Date.now()): number {
  return Math.max(1, Math.ceil((Date.parse(resetAt) - now) / 1000));
}
