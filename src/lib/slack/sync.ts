// Slack ↔ ticket sync helpers.
//
// Why this file exists:
//   - The `slack_messages` table is the only place that remembers
//     which Slack message is the master card for a given ticket. We
//     populate it on create and read it back when we need to update.
//   - The same `chat.update` call is needed by the Slack interactive
//     handlers (assign / in-progress / resolve) AND the web portal's
//     PATCH /api/tickets/[id]. Centralising the call here means
//     every change that should reflect in Slack goes through one
//     well-tested path.
//
// Errors from Slack are swallowed — the database is the system of
// record, the Slack card is a convenience. The ticket detail page
// can always be re-rendered and the master message can be manually
// re-posted if Slack ever falls out of sync.

import type { WebClient } from "@slack/web-api";
import { WebClient as WebClientCtor } from "@slack/web-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildMasterTicketMessage } from "./blocks/ticket-master";
import type { Ticket } from "@/types/ticket";

export interface SyncOptions {
  /**
   * Slack channel id. If omitted, will be looked up from
   * `slack_messages` → `slack_channels` for the ticket.
   */
  channelId?: string | null;
  /**
   * Slack message ts of the master message. If omitted, looked up
   * from `slack_messages` (the most recent `message_type = 'master'`
   * row for the ticket).
   */
  messageTs?: string | null;
  /**
   * Override the WebClient. Defaults to a new WebClient using
   * `process.env.SLACK_BOT_TOKEN`. Pass the caller's client to avoid
   * extra connection setup.
   */
  client?: WebClient;
}

export interface SyncResult {
  ok: boolean;
  reason?: "no_channel" | "no_message" | "no_token" | "slack_error";
  error?: string;
}

/**
 * Record that a master Block Kit message was posted to Slack for a
 * given ticket. Called from `createTicketCore()` after a successful
 * `chat.postMessage`. We keep the most recent master per ticket so
 * updates target the right message.
 */
export async function recordMasterMessage(args: {
  ticketId: string;
  slackChannelId: string;
  messageTs: string;
  messageType?: "master" | "thread_reply" | "notification";
}): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("slack_messages").insert({
    ticket_id: args.ticketId,
    slack_channel_id: args.slackChannelId,
    message_ts: args.messageTs,
    message_type: args.messageType ?? "master",
  });
  if (error) {
    console.error("[slack/sync] failed to record master message:", error);
  }
}

/**
 * Look up the master message (channel + ts) for a ticket, if any.
 * Returns `null` if no master has been recorded.
 */
async function lookupMaster(
  ticketId: string
): Promise<{ channelId: string; messageTs: string } | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("slack_messages")
    .select(
      "message_ts, message_type, slack_channels!inner(channel_id)"
    )
    .eq("ticket_id", ticketId)
    .eq("message_type", "master")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const ch = (Array.isArray(data.slack_channels)
    ? data.slack_channels[0]
    : data.slack_channels) as { channel_id: string } | null;
  if (!ch?.channel_id || !data.message_ts) return null;
  return { channelId: ch.channel_id, messageTs: data.message_ts };
}

/**
 * Update the master Block Kit message in Slack to reflect the latest
 * state of a ticket. Called from:
 *   - `createTicketCore()` (via `postMasterMessage()`)
 *   - the Slack interactive handlers (assign / in-progress / resolve)
 *   - `PATCH /api/tickets/[id]` (web portal change → Slack card update)
 *
 * The function never throws — Slack sync failures are logged and
 * returned via `SyncResult` so the caller can record them but the
 * primary write (DB) still succeeds.
 */
export async function updateMasterMessage(
  ticket: Ticket,
  options: SyncOptions = {}
): Promise<SyncResult> {
  // Resolve target channel + message ts.
  let channelId = options.channelId ?? null;
  let messageTs = options.messageTs ?? null;

  if (!channelId || !messageTs) {
    const found = await lookupMaster(ticket.id);
    if (found) {
      channelId = channelId ?? found.channelId;
      messageTs = messageTs ?? found.messageTs;
    }
  }

  if (!channelId) return { ok: false, reason: "no_channel" };
  if (!messageTs) return { ok: false, reason: "no_message" };

  // Resolve WebClient.
  const client =
    options.client ??
    (process.env.SLACK_BOT_TOKEN
      ? new WebClientCtor(process.env.SLACK_BOT_TOKEN)
      : null);
  if (!client) return { ok: false, reason: "no_token" };

  try {
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: `[${ticket.ticket_no}] ${ticket.title}`,
      blocks: buildMasterTicketMessage(ticket),
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[slack/sync] chat.update failed:", msg);
    return { ok: false, reason: "slack_error", error: msg };
  }
}
