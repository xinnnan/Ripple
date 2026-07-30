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
 * Record a comment through the database command that atomically writes the
 * comment, timeline/audit rows, and any first-response milestone change.
 */
export async function recordTicketCommentWithSla(args: {
  supabase: SupabaseClient;
  ticketId: string;
  actorId: string;
  body: string;
  visibility: CommentVisibility;
  source: TicketCommentSource;
  isAutomated?: boolean;
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "record_ticket_comment_with_sla",
    {
      p_ticket_id: args.ticketId,
      p_actor_id: args.actorId,
      p_body: args.body,
      p_visibility: args.visibility,
      p_source: args.source,
      p_is_automated: args.isAutomated ?? false,
    }
  );

  if (error || typeof data !== "string") {
    throw new Error(
      `Atomic ticket comment failed: ${error?.message ?? "invalid RPC response"}`
    );
  }

  return data;
}
