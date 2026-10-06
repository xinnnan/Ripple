import type { SupabaseClient } from "@supabase/supabase-js";
import { rateLimit } from "@/lib/rate-limit";
import {
  buildRateLimitBucketKey,
  consumeDistributedRateLimit,
  getRetryAfterSeconds,
} from "@/lib/distributed-rate-limit";

/**
 * Shared guard for guest operations authorized by a ticket share token
 * (`/t/{ticket_no}?token=`). The token is a 32-byte hex secret; possession
 * authorizes only the customer-visible contract for that one ticket.
 */
export const PUBLIC_TICKET_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
export const PUBLIC_TICKET_NO_PATTERN = /^RPL-\d{1,12}$/;

export type PublicTicketPurpose =
  | "ticket-view"
  | "attachment-download"
  | "guest-reply";

const LIMITS: Record<PublicTicketPurpose, { limit: number; windowSeconds: number }> = {
  "ticket-view": { limit: 30, windowSeconds: 60 },
  "attachment-download": { limit: 30, windowSeconds: 60 },
  // Replies create durable records and Slack posts, so they are tighter.
  "guest-reply": { limit: 10, windowSeconds: 600 },
};

export type PublicLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Process-local shedding first, then the distributed bucket (migration 046).
 * Throws when the distributed limiter is unavailable so callers fail closed.
 */
export async function consumePublicTicketLimit(args: {
  supabase: SupabaseClient;
  purpose: PublicTicketPurpose;
  clientIp: string;
}): Promise<PublicLimitResult> {
  const { limit, windowSeconds } = LIMITS[args.purpose];
  const local = rateLimit({
    key: `${args.purpose}:${args.clientIp}`,
    limit,
    windowMs: windowSeconds * 1000,
  });
  if (!local.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((local.resetAt - Date.now()) / 1000)),
    };
  }

  const distributed = await consumeDistributedRateLimit({
    supabase: args.supabase,
    bucketKey: buildRateLimitBucketKey(args.purpose, args.clientIp),
    limit,
    windowSeconds,
  });
  return distributed.allowed
    ? { allowed: true }
    : {
        allowed: false,
        retryAfterSeconds: getRetryAfterSeconds(distributed.resetAt),
      };
}

export function isPublicTicketCredential(ticketNo: string, token: unknown) {
  return (
    PUBLIC_TICKET_NO_PATTERN.test(ticketNo) &&
    typeof token === "string" &&
    PUBLIC_TICKET_TOKEN_PATTERN.test(token)
  );
}

/**
 * Resolve a share token to its ticket within an active site and an active or
 * trial customer. Returns null for any mismatch so callers answer 404.
 */
export async function findPublicTicketId(
  supabase: SupabaseClient,
  ticketNo: string,
  token: string
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("tickets")
    .select("id, customer:customers!inner(status), site:sites!inner(status)")
    .eq("ticket_no", ticketNo)
    .eq("secure_token", token)
    .eq("site.status", "active")
    .in("customer.status", ["active", "trial"])
    .maybeSingle();
  if (error) {
    throw new PublicTicketLookupError(error.code);
  }
  return data ? { id: (data as { id: string }).id } : null;
}

export class PublicTicketLookupError extends Error {
  constructor(readonly code?: string) {
    super("Public ticket lookup failed");
    this.name = "PublicTicketLookupError";
  }
}
