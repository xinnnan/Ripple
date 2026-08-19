import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  InvalidSlackEventCommentReplayError,
  recordSlackEventCommentWithSla,
} from "@/lib/tickets/mutations";
import { buildSlackEventCommentIdempotencyKey } from "@/lib/tickets/idempotency";
import { TICKET_COMMENT_MAX_LENGTH } from "@/lib/tickets/input-contract";

type SlackEventCaptureReason =
  | "not_event_callback"
  | "not_human_message"
  | "not_thread_reply"
  | "invalid_event"
  | "unsupported_content"
  | "unlinked_channel"
  | "unknown_thread"
  | "unlinked_actor"
  | "replay_conflict";

export type SlackEventCaptureResult =
  | { outcome: "recorded"; commentId: string }
  | { outcome: "ignored"; reason: SlackEventCaptureReason };

type CaptureDependencies = {
  supabase: SupabaseClient;
  recordComment: typeof recordSlackEventCommentWithSla;
};

function defaultDependencies(): CaptureDependencies {
  return {
    supabase: createAdminClient(),
    recordComment: recordSlackEventCommentWithSla,
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function boundedIdentifier(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= maxLength
    ? normalized
    : null;
}

function exactSingle<T>(args: {
  data: T[] | null;
  error: { code?: string } | null;
  context: string;
}): T | null {
  if (args.error) {
    console.error(`[slack/events] ${args.context} lookup failed:`, {
      code: args.error.code,
    });
    throw new Error("Slack event lookup failed");
  }
  if (!args.data || args.data.length === 0) return null;
  if (args.data.length !== 1) {
    console.error(`[slack/events] ${args.context} mapping is ambiguous`);
    throw new Error("Slack event mapping is ambiguous");
  }
  return args.data[0];
}

export async function captureSlackThreadReply(
  payload: unknown,
  dependencies: CaptureDependencies = defaultDependencies()
): Promise<SlackEventCaptureResult> {
  const envelope = objectValue(payload);
  if (envelope?.type !== "event_callback") {
    return { outcome: "ignored", reason: "not_event_callback" };
  }

  const event = objectValue(envelope.event);
  const eventId = boundedIdentifier(envelope.event_id);
  if (!event || !eventId) {
    return { outcome: "ignored", reason: "invalid_event" };
  }

  const subtype = event.subtype;
  if (
    event.type !== "message" ||
    (subtype !== undefined && subtype !== "thread_broadcast") ||
    event.bot_id !== undefined ||
    event.bot_profile !== undefined ||
    event.app_id !== undefined
  ) {
    return { outcome: "ignored", reason: "not_human_message" };
  }

  const channelId = boundedIdentifier(event.channel, 50);
  const slackUserId = boundedIdentifier(event.user, 50);
  const messageTs = boundedIdentifier(event.ts, 50);
  const threadTs = boundedIdentifier(event.thread_ts, 50);
  if (!channelId || !slackUserId || !messageTs) {
    return { outcome: "ignored", reason: "invalid_event" };
  }
  if (!threadTs || threadTs === messageTs) {
    return { outcome: "ignored", reason: "not_thread_reply" };
  }

  const body = typeof event.text === "string" ? event.text.trim() : "";
  if (!body || body.length > TICKET_COMMENT_MAX_LENGTH) {
    return { outcome: "ignored", reason: "unsupported_content" };
  }

  let idempotencyKey: string;
  try {
    idempotencyKey = buildSlackEventCommentIdempotencyKey(eventId);
  } catch {
    return { outcome: "ignored", reason: "invalid_event" };
  }

  const siteResult = await dependencies.supabase
    .from("sites")
    .select("id, customer:customers!inner(status)")
    .eq("slack_channel_id", channelId)
    .eq("status", "active")
    .in("customer.status", ["active", "trial"])
    .limit(2);
  const site = exactSingle({
    data: siteResult.data as Array<{ id: string }> | null,
    error: siteResult.error,
    context: "site channel",
  });
  if (!site) return { outcome: "ignored", reason: "unlinked_channel" };

  const channelResult = await dependencies.supabase
    .from("slack_channels")
    .select("id, site_id")
    .eq("channel_id", channelId)
    .eq("site_id", site.id)
    .limit(2);
  const channel = exactSingle({
    data: channelResult.data as Array<{ id: string; site_id: string }> | null,
    error: channelResult.error,
    context: "channel",
  });
  if (!channel) return { outcome: "ignored", reason: "unlinked_channel" };

  const masterResult = await dependencies.supabase
    .from("slack_messages")
    .select("ticket_id, ticket:tickets!inner(site_id)")
    .eq("slack_channel_id", channel.id)
    .eq("message_ts", threadTs)
    .eq("message_type", "master")
    .eq("ticket.site_id", site.id)
    .limit(2);
  const master = exactSingle({
    data: masterResult.data as Array<{ ticket_id: string }> | null,
    error: masterResult.error,
    context: "thread",
  });
  if (!master) return { outcome: "ignored", reason: "unknown_thread" };

  const actorResult = await dependencies.supabase
    .from("users")
    .select("id")
    .eq("slack_user_id", slackUserId)
    .eq("status", "active")
    .limit(2);
  const actor = exactSingle({
    data: actorResult.data as Array<{ id: string }> | null,
    error: actorResult.error,
    context: "actor",
  });
  if (!actor) return { outcome: "ignored", reason: "unlinked_actor" };

  try {
    const commentId = await dependencies.recordComment({
      supabase: dependencies.supabase,
      ticketId: master.ticket_id,
      actorId: actor.id,
      body,
      idempotencyKey,
    });
    return { outcome: "recorded", commentId };
  } catch (error) {
    if (error instanceof InvalidSlackEventCommentReplayError) {
      console.warn("[slack/events] altered event replay rejected");
      return { outcome: "ignored", reason: "replay_conflict" };
    }
    throw error;
  }
}
