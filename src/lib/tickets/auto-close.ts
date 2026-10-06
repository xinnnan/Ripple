import type { SupabaseClient } from "@supabase/supabase-js";

/** One cron run closes at most this many tickets; the rest wait a day. */
export const AUTO_CLOSE_BATCH_LIMIT = 200;

/**
 * Close resolved tickets after seven days without customer activity
 * (migration 058). Each closure writes timeline, audit, and Slack sync
 * evidence in the same transaction.
 */
export async function closeStaleResolvedTickets(
  supabase: SupabaseClient
): Promise<number> {
  const { data, error } = await supabase.rpc(
    "close_stale_resolved_tickets_atomic",
    { p_limit: AUTO_CLOSE_BATCH_LIMIT }
  );
  if (error || typeof data !== "number" || !Number.isInteger(data) || data < 0) {
    throw new Error("Auto-close command failed");
  }
  return data;
}
