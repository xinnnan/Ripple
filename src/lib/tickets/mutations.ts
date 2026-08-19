import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CommentVisibility,
  Severity,
  TicketStatus,
} from "@/types/ticket";

export type TicketMutationSource = "web" | "slack" | "email" | "internal";
export type TicketCommentSource = "web" | "slack" | "email";

export interface TicketPatch {
  status?: TicketStatus;
  severity?: Severity;
  owner_id?: string | null;
  customer_visible_summary?: string | null;
  internal_summary?: string | null;
  root_cause_category?: string | null;
  follow_up_needed?: boolean;
}

export class InvalidTicketTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTicketTransitionError";
  }
}

export class InvalidTicketCommentReplayError extends Error {
  constructor() {
    super("This comment request key was already used for different content.");
    this.name = "InvalidTicketCommentReplayError";
  }
}

export class InvalidSlackEventCommentReplayError extends Error {
  constructor() {
    super("This Slack event key was already used for different content.");
    this.name = "InvalidSlackEventCommentReplayError";
  }
}

function safeTransitionMessage(databaseMessage: string): string {
  if (databaseMessage.startsWith("Invalid ticket status transition:")) {
    return databaseMessage;
  }
  if (
    databaseMessage.includes(
      "Assigned and in-progress tickets require an owner"
    )
  ) {
    return "Assigned and in-progress tickets require an owner.";
  }
  if (
    databaseMessage.includes(
      "Resolved tickets require a customer-visible summary"
    )
  ) {
    return "Resolved tickets require a customer-visible summary.";
  }
  return "The ticket status transition is not allowed.";
}

/**
 * Apply a ticket patch through the row-locked database command introduced in
 * migration 026. The command owns milestone calculation and writes ticket
 * events + audit rows in the same transaction as the ticket update.
 */
export async function applyTicketPatchWithSla(args: {
  supabase: SupabaseClient;
  ticketId: string;
  actorId: string;
  patch: TicketPatch;
  source: TicketMutationSource;
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "apply_ticket_patch_with_sla",
    {
      p_ticket_id: args.ticketId,
      p_actor_id: args.actorId,
      p_patch: args.patch,
      p_source: args.source,
    }
  );

  if (error || typeof data !== "string") {
    if (error?.code === "23514") {
      throw new InvalidTicketTransitionError(
        safeTransitionMessage(error.message)
      );
    }
    throw new Error(
      `Atomic ticket update failed: ${error?.message ?? "invalid RPC response"}`
    );
  }

  return data;
}

/**
 * Record or exactly replay a comment through migration 048's wrapper. The
 * command atomically writes the comment, replay receipt, timeline/audit rows,
 * any first-response milestone change, and the customer-visible Slack event.
 */
export async function recordTicketCommentWithSla(args: {
  supabase: SupabaseClient;
  ticketId: string;
  actorId: string;
  body: string;
  visibility: CommentVisibility;
  source: TicketCommentSource;
  isAutomated?: boolean;
  idempotencyKey: string;
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "record_ticket_comment_idempotent_atomic",
    {
      p_input: {
        ticket_id: args.ticketId,
        actor_id: args.actorId,
        body: args.body,
        visibility: args.visibility,
        source: args.source,
        is_automated: args.isAutomated ?? false,
        idempotency_key: args.idempotencyKey,
      },
    }
  );

  if (error || typeof data !== "string") {
    if (
      error?.code === "22023" &&
      error.message.includes("Comment idempotency key")
    ) {
      throw new InvalidTicketCommentReplayError();
    }
    throw new Error("Atomic ticket comment failed");
  }

  return data;
}

/**
 * Capture a human message that Slack has already delivered in a ticket
 * thread. Migration 053 owns exact replay and calls the atomic comment/SLA
 * command without creating a Slack reply outbox event, preventing an echo.
 */
export async function recordSlackEventCommentWithSla(args: {
  supabase: SupabaseClient;
  ticketId: string;
  actorId: string;
  body: string;
  idempotencyKey: string;
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "record_slack_event_comment_atomic",
    {
      p_input: {
        ticket_id: args.ticketId,
        actor_id: args.actorId,
        body: args.body,
        idempotency_key: args.idempotencyKey,
      },
    }
  );

  if (error || typeof data !== "string") {
    if (
      error?.code === "22023" &&
      error.message.includes("Slack event idempotency key")
    ) {
      throw new InvalidSlackEventCommentReplayError();
    }
    throw new Error("Atomic Slack event comment failed");
  }

  return data;
}
