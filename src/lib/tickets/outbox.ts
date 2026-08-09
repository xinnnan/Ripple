import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  postMasterMessage,
  postMasterThreadReply,
  updateMasterMessage,
  type SyncOptions,
  type SyncResult,
} from "@/lib/slack/sync";
import {
  sendTicketConfirmation,
  sendTicketResolved,
  type SendResult,
} from "@/lib/email/send";
import type { Ticket } from "@/types/ticket";

export const TICKET_OUTBOX_EVENT_TYPES = [
  "ticket.slack_master_create",
  "ticket.email_confirmation",
  "ticket.slack_master_sync",
  "ticket.slack_comment_reply",
  "ticket.slack_resolution_reply",
  "ticket.email_resolution",
] as const;

export type TicketOutboxEventType =
  (typeof TICKET_OUTBOX_EVENT_TYPES)[number];

export interface IntegrationOutboxEvent {
  id: string;
  aggregate_type: "ticket";
  aggregate_id: string;
  event_type: TicketOutboxEventType;
  idempotency_key: string;
  payload: Record<string, unknown>;
  status: "processing";
  attempts: number;
  max_attempts: number;
  available_at: string;
  locked_at: string;
  lock_token: string;
  delivered_at: string | null;
  dead_lettered_at: string | null;
  last_error: string | null;
  delivery_result: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OutboxTicket extends Ticket {
  submitter_email?: string | null;
}

export type OutboxDeliveryDecision =
  | {
      delivered: true;
      result: Record<string, unknown>;
    }
  | {
      delivered: false;
      retryable: boolean;
      error: string;
      result: Record<string, unknown>;
    };

interface TicketOutboxDeliveryDependencies {
  postMasterMessage: typeof postMasterMessage;
  updateMasterMessage: typeof updateMasterMessage;
  postMasterThreadReply: typeof postMasterThreadReply;
  sendTicketConfirmation: typeof sendTicketConfirmation;
  sendTicketResolved: typeof sendTicketResolved;
}

const defaultDeliveryDependencies: TicketOutboxDeliveryDependencies = {
  postMasterMessage,
  updateMasterMessage,
  postMasterThreadReply,
  sendTicketConfirmation,
  sendTicketResolved,
};

function slackDecision(result: SyncResult): OutboxDeliveryDecision {
  if (result.ok) {
    return {
      delivered: true,
      result: {
        provider: "slack",
        outcome: result.deduplicated ? "deduplicated" : "sent",
      },
    };
  }

  // A ticket without a linked channel/master message has no Slack delivery
  // target. That is an intentional terminal skip, not a failing integration.
  if (result.reason === "no_channel" || result.reason === "no_message") {
    return {
      delivered: true,
      result: {
        provider: "slack",
        outcome: "skipped",
        reason: result.reason,
      },
    };
  }

  return {
    delivered: false,
    retryable: true,
    error: result.error ?? result.reason ?? "Unknown Slack delivery failure",
    result: {
      provider: "slack",
      outcome: "failed",
      reason: result.reason ?? "unknown",
    },
  };
}

function emailDecision(result: SendResult): OutboxDeliveryDecision {
  if (result.sent) {
    return {
      delivered: true,
      result: {
        provider: "resend",
        outcome: "sent",
        provider_id: result.id,
      },
    };
  }

  return {
    delivered: false,
    retryable: true,
    error: result.error ?? result.reason,
    result: {
      provider: "resend",
      outcome: "failed",
      reason: result.reason,
    },
  };
}

/**
 * Deliver one already-claimed event. The event id is propagated to providers
 * as the stable idempotency key; database lease completion happens separately.
 */
export async function deliverTicketOutboxEvent(
  event: IntegrationOutboxEvent,
  ticket: OutboxTicket,
  slackOptions: SyncOptions = {},
  dependencies: TicketOutboxDeliveryDependencies =
    defaultDeliveryDependencies
): Promise<OutboxDeliveryDecision> {
  switch (event.event_type) {
    case "ticket.slack_master_create":
      return slackDecision(
        await dependencies.postMasterMessage(ticket, {
          ...slackOptions,
          deliveryKey: event.id,
        })
      );

    case "ticket.email_confirmation": {
      if (!ticket.submitter_email) {
        return {
          delivered: true,
          result: {
            provider: "resend",
            outcome: "skipped",
            reason: "no_recipient",
          },
        };
      }
      const customer = (Array.isArray(ticket.customer)
        ? ticket.customer[0]
        : ticket.customer) as { name?: string } | null;
      const site = (Array.isArray(ticket.site)
        ? ticket.site[0]
        : ticket.site) as { site_name?: string } | null;
      return emailDecision(
        await dependencies.sendTicketConfirmation({
          to: ticket.submitter_email,
          ticketNo: ticket.ticket_no,
          title: ticket.title,
          secureToken: ticket.secure_token,
          customerName: customer?.name ?? "Customer",
          siteName: site?.site_name ?? "Site",
          idempotencyKey: `ripple-outbox/${event.id}`,
        })
      );
    }

    case "ticket.slack_master_sync":
      return slackDecision(
        await dependencies.updateMasterMessage(ticket, {
          ...slackOptions,
          deliveryKey: event.id,
        })
      );

    case "ticket.slack_comment_reply": {
      const messageText = event.payload.message_text;
      if (
        typeof messageText !== "string" ||
        messageText.length < 1 ||
        messageText.length > 12_000
      ) {
        return {
          delivered: false,
          retryable: false,
          error: "Slack comment delivery payload is invalid",
          result: {
            provider: "slack",
            outcome: "failed",
            reason: "invalid_payload",
          },
        };
      }
      return slackDecision(
        await dependencies.postMasterThreadReply(ticket, messageText, {
          ...slackOptions,
          deliveryKey: event.id,
        })
      );
    }

    case "ticket.slack_resolution_reply": {
      const summary =
        ticket.customer_visible_summary?.trim() ||
        "Your ticket has been resolved. Please reply if anything is still off.";
      return slackDecision(
        await dependencies.postMasterThreadReply(
          ticket,
          `✅ Ticket Resolved\n\n${summary}`,
          {
            ...slackOptions,
            deliveryKey: event.id,
          }
        )
      );
    }

    case "ticket.email_resolution": {
      if (!ticket.submitter_email) {
        return {
          delivered: true,
          result: {
            provider: "resend",
            outcome: "skipped",
            reason: "no_recipient",
          },
        };
      }
      const summary =
        ticket.customer_visible_summary?.trim() ||
        "Your ticket has been resolved. Please reply if anything is still off.";
      return emailDecision(
        await dependencies.sendTicketResolved({
          to: ticket.submitter_email,
          ticketNo: ticket.ticket_no,
          title: ticket.title,
          secureToken: ticket.secure_token,
          resolutionSummary: summary,
          idempotencyKey: `ripple-outbox/${event.id}`,
        })
      );
    }
  }
}

async function claimEvents(
  supabase: SupabaseClient,
  args: {
    limit: number;
    aggregateId?: string;
  }
): Promise<IntegrationOutboxEvent[]> {
  const { data, error } = await supabase.rpc("claim_integration_outbox", {
    p_limit: args.limit,
    p_aggregate_type: "ticket",
    p_aggregate_id: args.aggregateId ?? null,
  });
  if (error || !Array.isArray(data)) {
    throw new Error(
      `Outbox claim failed: ${error?.message ?? "invalid RPC response"}`
    );
  }
  return data as IntegrationOutboxEvent[];
}

async function loadTicket(
  supabase: SupabaseClient,
  ticketId: string
): Promise<OutboxTicket | null> {
  const { data, error } = await supabase
    .from("tickets")
    .select(
      `
      *,
      customer:customers(id, name),
      site:sites(id, site_name, site_code, slack_channel_id, timezone),
      owner:users!tickets_owner_id_fkey(id, full_name, email),
      creator:users!tickets_created_by_fkey(id, full_name, email)
    `
    )
    .eq("id", ticketId)
    .maybeSingle();
  if (error) {
    throw new Error(`Outbox ticket hydration failed: ${error.message}`);
  }
  return (data as OutboxTicket | null) ?? null;
}

async function markDelivered(
  supabase: SupabaseClient,
  event: IntegrationOutboxEvent,
  result: Record<string, unknown>
): Promise<void> {
  const { data, error } = await supabase.rpc(
    "mark_integration_outbox_delivered",
    {
      p_event_id: event.id,
      p_lock_token: event.lock_token,
      p_delivery_result: result,
    }
  );
  if (error || data !== true) {
    throw new Error(
      `Outbox delivery acknowledgement failed: ${
        error?.message ?? "lease no longer owned"
      }`
    );
  }
}

async function markFailed(
  supabase: SupabaseClient,
  event: IntegrationOutboxEvent,
  decision: Extract<OutboxDeliveryDecision, { delivered: false }>
): Promise<void> {
  const { data, error } = await supabase.rpc(
    "mark_integration_outbox_failed",
    {
      p_event_id: event.id,
      p_lock_token: event.lock_token,
      p_error: decision.error,
      p_retryable: decision.retryable,
      p_delivery_result: decision.result,
    }
  );
  if (error || data !== true) {
    throw new Error(
      `Outbox failure acknowledgement failed: ${
        error?.message ?? "lease no longer owned"
      }`
    );
  }
}

export interface OutboxDispatchSummary {
  claimed: number;
  delivered: number;
  deferred: number;
  processingErrors: number;
  unavailable?: boolean;
}

/**
 * Claim and process a bounded batch. Database leases prevent concurrent cron
 * and request-path dispatchers from handling the same event simultaneously.
 */
export async function dispatchTicketOutbox(args: {
  limit?: number;
  aggregateId?: string;
  slackOptions?: SyncOptions;
} = {}): Promise<OutboxDispatchSummary> {
  const supabase = createAdminClient();
  const events = await claimEvents(supabase, {
    limit: args.limit ?? 20,
    aggregateId: args.aggregateId,
  });
  const ticketCache = new Map<string, OutboxTicket | null>();
  let delivered = 0;
  let deferred = 0;
  let processingErrors = 0;

  for (const event of events) {
    try {
      let ticket = ticketCache.get(event.aggregate_id);
      if (ticket === undefined) {
        ticket = await loadTicket(supabase, event.aggregate_id);
        ticketCache.set(event.aggregate_id, ticket);
      }

      if (!ticket) {
        await markFailed(supabase, event, {
          delivered: false,
          retryable: false,
          error: "Ticket no longer exists",
          result: { outcome: "failed", reason: "missing_aggregate" },
        });
        deferred += 1;
        continue;
      }

      const decision = await deliverTicketOutboxEvent(
        event,
        ticket,
        args.slackOptions
      );
      if (decision.delivered) {
        await markDelivered(supabase, event, decision.result);
        delivered += 1;
      } else {
        await markFailed(supabase, event, decision);
        deferred += 1;
      }
    } catch (error) {
      processingErrors += 1;
      console.error(
        `[outbox] event ${event.id} processing failed:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return {
    claimed: events.length,
    delivered,
    deferred,
    processingErrors,
  };
}

/**
 * Request-path convenience wrapper. An outbox outage must never turn an
 * already-committed ticket mutation into an HTTP/Slack failure that callers
 * might retry. The scheduled worker uses the strict dispatcher instead.
 */
export async function dispatchTicketOutboxBestEffort(args: {
  aggregateId: string;
  slackOptions?: SyncOptions;
}): Promise<OutboxDispatchSummary> {
  try {
    return await dispatchTicketOutbox({
      aggregateId: args.aggregateId,
      slackOptions: args.slackOptions,
    });
  } catch (error) {
    console.error(
      "[outbox] immediate dispatch unavailable:",
      error instanceof Error ? error.message : error
    );
    return {
      claimed: 0,
      delivered: 0,
      deferred: 0,
      processingErrors: 0,
      unavailable: true,
    };
  }
}
