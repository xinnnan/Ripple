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
// Errors are returned as typed retry decisions — the database remains the
// system of record. Ambiguous posts are reconciled through their Slack metadata
// before a retry, while target/receipt lookup failures fail closed.

import type { WebClient } from "@slack/web-api";
import { WebClient as WebClientCtor } from "@slack/web-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildMasterTicketMessage } from "./blocks/ticket-master";
import {
  boundedSlackProviderCode,
  findSlackDeliveryByMetadata,
} from "./delivery-reconciliation";
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
  /**
   * Durable delivery id from `integration_outbox`. Thread replies record this
   * value locally and attach it as Slack metadata so a retried worker can
   * recognize an already-recorded delivery.
   */
  deliveryKey?: string;
  /**
   * Reconcile a previous ambiguous provider attempt before posting again.
   * The provider lookup fails closed: absence must be proven before a retry.
   */
  reconcileDelivery?: boolean;
  /** Timestamp of the previous provider attempt used to bound reconciliation. */
  reconcileFrom?: string;
  /**
   * Durable outbox hook invoked immediately before a provider write. It must
   * return the timestamp committed under the current queue lease. A failed
   * hook prevents Slack I/O.
   */
  beforeProviderAttempt?: () => Promise<string>;
}

export interface SyncResult {
  ok: boolean;
  reason?:
    | "no_channel"
    | "no_message"
    | "no_token"
    | "database_error"
    | "reconciliation_error"
    | "slack_error";
  error?: string;
  deduplicated?: boolean;
  providerAttemptedAt?: string;
}

async function resolveTarget(
  ticketId: string,
  options: SyncOptions
): Promise<{
  target: {
    channelId: string;
    channelRecordId: string;
    messageTs: string;
  } | null;
  errorCode?: string;
}> {
  let channelId = options.channelId ?? null;
  let messageTs = options.messageTs ?? null;
  let channelRecordId: string | null = null;

  if (!channelId || !messageTs) {
    const found = await lookupMaster(ticketId);
    if (found.errorCode) return { target: null, errorCode: found.errorCode };
    if (found.target) {
      channelId = channelId ?? found.target.channelId;
      messageTs = messageTs ?? found.target.messageTs;
      channelRecordId = found.target.channelRecordId;
    }
  }

  if (channelId && !channelRecordId) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("slack_channels")
      .select("id")
      .eq("channel_id", channelId)
      .maybeSingle();
    if (error) {
      console.error("[slack/sync] channel lookup failed:", {
        code: error.code,
      });
      return { target: null, errorCode: "channel_lookup_failed" };
    }
    channelRecordId = data?.id ?? null;
  }

  return {
    target:
      channelId && channelRecordId && messageTs
        ? { channelId, channelRecordId, messageTs }
        : null,
  };
}

function resolveClient(options: SyncOptions): WebClient | null {
  return (
    options.client ??
    (process.env.SLACK_BOT_TOKEN
      ? new WebClientCtor(process.env.SLACK_BOT_TOKEN)
      : null)
  );
}

async function beginProviderAttempt(
  options: SyncOptions
): Promise<
  | { ok: true; attemptedAt: string }
  | { ok: false; result: SyncResult }
> {
  try {
    const attemptedAt = options.beforeProviderAttempt
      ? await options.beforeProviderAttempt()
      : new Date().toISOString();
    if (!Number.isFinite(Date.parse(attemptedAt))) {
      return {
        ok: false,
        result: {
          ok: false,
          reason: "database_error",
          error: "Slack provider attempt timestamp is invalid",
        },
      };
    }
    return { ok: true, attemptedAt };
  } catch {
    console.error("[slack/sync] provider attempt could not be recorded");
    return {
      ok: false,
      result: {
        ok: false,
        reason: "database_error",
        error: "Slack provider attempt could not be recorded",
      },
    };
  }
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
  outboxEventId?: string | null;
}): Promise<SyncResult> {
  const supabase = createAdminClient();
  const row: Record<string, string> = {
    ticket_id: args.ticketId,
    slack_channel_id: args.slackChannelId,
    message_ts: args.messageTs,
    message_type: args.messageType ?? "master",
  };
  if (args.outboxEventId) row.outbox_event_id = args.outboxEventId;
  const { error } = await supabase.from("slack_messages").insert(row);
  if (error) {
    if (error.code === "23505" && args.outboxEventId) {
      const existing = await supabase
        .from("slack_messages")
        .select("id")
        .eq("outbox_event_id", args.outboxEventId)
        .maybeSingle();
      if (!existing.error && existing.data) {
        return { ok: true, deduplicated: true };
      }
    }
    console.error("[slack/sync] failed to record Slack message:", {
      code: error.code,
    });
    return {
      ok: false,
      reason: "database_error",
      error: "Slack delivery receipt could not be recorded",
    };
  }
  return { ok: true };
}

async function reconcilePostedDelivery(args: {
  ticketId: string;
  channelId: string;
  channelRecordId: string;
  messageType: "master" | "notification";
  client: WebClient;
  options: SyncOptions;
  threadTs?: string;
}): Promise<SyncResult | null> {
  if (!args.options.deliveryKey || !args.options.reconcileDelivery) return null;
  if (!args.options.reconcileFrom) {
    return {
      ok: false,
      reason: "reconciliation_error",
      error: "Slack delivery reconciliation window is unavailable",
    };
  }

  const reconciliation = await findSlackDeliveryByMetadata({
    client: args.client,
    channelId: args.channelId,
    deliveryKey: args.options.deliveryKey,
    attemptedAt: args.options.reconcileFrom,
    threadTs: args.threadTs,
  });
  if (!reconciliation.ok) {
    console.error("[slack/sync] delivery reconciliation failed:", {
      code: reconciliation.errorCode,
    });
    return {
      ok: false,
      reason: "reconciliation_error",
      error: `Slack delivery reconciliation failed (${reconciliation.errorCode})`,
    };
  }
  if (!reconciliation.messageTs) return null;

  const recorded = await recordMasterMessage({
    ticketId: args.ticketId,
    slackChannelId: args.channelRecordId,
    messageTs: reconciliation.messageTs,
    messageType: args.messageType,
    outboxEventId: args.options.deliveryKey,
  });
  return recorded.ok ? { ok: true, deduplicated: true } : recorded;
}

/**
 * Post the first master Block Kit message for a ticket.
 *
 * Existing master records make retries a no-op. The outbox event id is stored
 * with the Slack record and attached as message metadata for traceability.
 */
export async function postMasterMessage(
  ticket: Ticket,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const existing = await lookupMaster(ticket.id);
  if (existing.errorCode) {
    return {
      ok: false,
      reason: "database_error",
      error: "Slack master receipt lookup failed",
    };
  }
  if (existing.target) return { ok: true, deduplicated: true };

  const site = (Array.isArray(ticket.site)
    ? ticket.site[0]
    : ticket.site) as {
      slack_channel_id?: string | null;
    } | null;
  const channelId = options.channelId ?? site?.slack_channel_id ?? null;
  if (!channelId) return { ok: false, reason: "no_channel" };

  const supabase = createAdminClient();
  const { data: channelRecord, error: channelError } = await supabase
    .from("slack_channels")
    .select("id")
    .eq("site_id", ticket.site_id)
    .eq("channel_id", channelId)
    .limit(1)
    .maybeSingle();
  if (channelError) {
    console.error("[slack/sync] site channel lookup failed:", {
      code: channelError.code,
    });
    return {
      ok: false,
      reason: "database_error",
      error: "Slack site channel lookup failed",
    };
  }
  if (!channelRecord) {
    return { ok: false, reason: "no_channel" };
  }

  const client = resolveClient(options);
  if (!client) return { ok: false, reason: "no_token" };

  const reconciled = await reconcilePostedDelivery({
    ticketId: ticket.id,
    channelId,
    channelRecordId: channelRecord.id,
    messageType: "master",
    client,
    options,
  });
  if (reconciled) return reconciled;

  const attempt = await beginProviderAttempt(options);
  if (!attempt.ok) return attempt.result;
  const providerAttemptedAt = attempt.attemptedAt;
  try {
    const response = await client.chat.postMessage({
      channel: channelId,
      text: `🎫 New ticket: [${ticket.ticket_no}] ${ticket.title}`,
      blocks: buildMasterTicketMessage(ticket),
      metadata: options.deliveryKey
        ? {
            event_type: "ripple_ticket_delivery",
            event_payload: { outbox_event_id: options.deliveryKey },
          }
        : undefined,
    });
    if (!response.ts) {
      return {
        ok: false,
        reason: "slack_error",
        error: "Slack did not return a message timestamp",
        providerAttemptedAt,
      };
    }

    const recorded = await recordMasterMessage({
      ticketId: ticket.id,
      slackChannelId: channelRecord.id,
      messageTs: response.ts,
      messageType: "master",
      outboxEventId: options.deliveryKey,
    });
    return recorded.ok ? recorded : { ...recorded, providerAttemptedAt };
  } catch (error) {
    const code = boundedSlackProviderCode(error);
    console.error("[slack/sync] master post failed:", { code });
    return {
      ok: false,
      reason: "slack_error",
      error: `Slack master post failed (${code})`,
      providerAttemptedAt,
    };
  }
}

/**
 * Look up the master message (channel + ts) for a ticket, if any.
 * Returns `null` if no master has been recorded.
 */
async function lookupMaster(
  ticketId: string
): Promise<{
  target: {
    channelId: string;
    channelRecordId: string;
    messageTs: string;
  } | null;
  errorCode?: string;
}> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("slack_messages")
    .select(
      "message_ts, message_type, slack_channels!inner(id, channel_id)"
    )
    .eq("ticket_id", ticketId)
    .eq("message_type", "master")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[slack/sync] master receipt lookup failed:", {
      code: error.code,
    });
    return { target: null, errorCode: "master_receipt_lookup_failed" };
  }
  if (!data) return { target: null };
  const channelRecord = (Array.isArray(data.slack_channels)
    ? data.slack_channels[0]
    : data.slack_channels) as {
      id: string;
      channel_id: string;
    } | null;
  if (!channelRecord?.id || !channelRecord.channel_id || !data.message_ts) {
    return { target: null, errorCode: "master_receipt_invalid" };
  }
  return {
    target: {
      channelId: channelRecord.channel_id,
      channelRecordId: channelRecord.id,
      messageTs: data.message_ts,
    },
  };
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
  const resolved = await resolveTarget(ticket.id, options);
  if (resolved.errorCode) {
    return {
      ok: false,
      reason: "database_error",
      error: "Slack master target lookup failed",
    };
  }
  const target = resolved.target;
  if (!target) {
    return {
      ok: false,
      reason: options.channelId ? "no_message" : "no_channel",
    };
  }

  const client = resolveClient(options);
  if (!client) return { ok: false, reason: "no_token" };

  try {
    await client.chat.update({
      channel: target.channelId,
      ts: target.messageTs,
      text: `[${ticket.ticket_no}] ${ticket.title}`,
      blocks: buildMasterTicketMessage(ticket),
    });
    return { ok: true };
  } catch (e) {
    const code = boundedSlackProviderCode(e);
    console.error("[slack/sync] chat.update failed:", { code });
    return {
      ok: false,
      reason: "slack_error",
      error: `Slack master update failed (${code})`,
    };
  }
}

/**
 * Post a plain-text reply beneath the ticket's master message.
 *
 * Like master-card sync, this is best-effort and never throws. Setting
 * `mrkdwn: false` prevents a resolution summary from turning customer-entered
 * text into Slack mentions or formatting directives.
 */
export async function postMasterThreadReply(
  ticket: Ticket,
  text: string,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const resolved = await resolveTarget(ticket.id, options);
  if (resolved.errorCode) {
    return {
      ok: false,
      reason: "database_error",
      error: "Slack thread target lookup failed",
    };
  }
  const target = resolved.target;
  if (!target) {
    return {
      ok: false,
      reason: options.channelId ? "no_message" : "no_channel",
    };
  }

  const client = resolveClient(options);
  if (!client) return { ok: false, reason: "no_token" };

  let providerAttemptedAt: string | undefined;
  try {
    if (options.deliveryKey) {
      const supabase = createAdminClient();
      const { data: recorded, error } = await supabase
        .from("slack_messages")
        .select("id")
        .eq("outbox_event_id", options.deliveryKey)
        .maybeSingle();
      if (error) {
        console.error("[slack/sync] thread receipt lookup failed:", {
          code: error.code,
        });
        return {
          ok: false,
          reason: "database_error",
          error: "Slack thread receipt lookup failed",
        };
      }
      if (recorded) {
        return { ok: true, deduplicated: true };
      }
    }

    const reconciled = await reconcilePostedDelivery({
      ticketId: ticket.id,
      channelId: target.channelId,
      channelRecordId: target.channelRecordId,
      messageType: "notification",
      client,
      options,
      threadTs: target.messageTs,
    });
    if (reconciled) return reconciled;

    const attempt = await beginProviderAttempt(options);
    if (!attempt.ok) return attempt.result;
    providerAttemptedAt = attempt.attemptedAt;
    const response = await client.chat.postMessage({
      channel: target.channelId,
      thread_ts: target.messageTs,
      text,
      mrkdwn: false,
      metadata: options.deliveryKey
        ? {
            event_type: "ripple_ticket_delivery",
            event_payload: { outbox_event_id: options.deliveryKey },
          }
        : undefined,
    });

    if (!response.ts) {
      return {
        ok: false,
        reason: "slack_error",
        error: "Slack did not return a message timestamp",
        providerAttemptedAt,
      };
    }

    if (options.deliveryKey) {
      const recorded = await recordMasterMessage({
        ticketId: ticket.id,
        slackChannelId: target.channelRecordId,
        messageTs: response.ts,
        messageType: "notification",
        outboxEventId: options.deliveryKey,
      });
      if (!recorded.ok) return { ...recorded, providerAttemptedAt };
    }
    return { ok: true };
  } catch (error) {
    const code = boundedSlackProviderCode(error);
    console.error("[slack/sync] thread reply failed:", { code });
    return {
      ok: false,
      reason: "slack_error",
      error: `Slack thread reply failed (${code})`,
      providerAttemptedAt,
    };
  }
}
