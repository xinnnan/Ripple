import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeIdempotencyKey } from "@/lib/idempotency";

/** Migration 058's reply ledger stores keys of at most 180 characters. */
export const CUSTOMER_REPLY_KEY_MAX_LENGTH = 180;

export class TicketNotReopenableError extends Error {
  constructor() {
    super("This ticket can no longer be reopened. Please submit a new ticket.");
    this.name = "TicketNotReopenableError";
  }
}

export class InvalidCustomerReplyReplayError extends Error {
  constructor() {
    super("This reply request key was already used for different content.");
    this.name = "InvalidCustomerReplyReplayError";
  }
}

export class CustomerReplyForbiddenError extends Error {
  constructor() {
    super("You cannot reply to this ticket.");
    this.name = "CustomerReplyForbiddenError";
  }
}

export class PublicTicketNotFoundError extends Error {
  constructor() {
    super("Ticket not found");
    this.name = "PublicTicketNotFoundError";
  }
}

export function normalizeCustomerReplyKey(value: string | null | undefined) {
  const key = normalizeIdempotencyKey(value);
  return key && key.length <= CUSTOMER_REPLY_KEY_MAX_LENGTH ? key : null;
}

function throwReplyError(error: { code?: string; message?: string } | null): never {
  const message = error?.message ?? "";
  if (error?.code === "23514" && message === "Ticket can no longer be reopened") {
    throw new TicketNotReopenableError();
  }
  if (error?.code === "22023" && message.startsWith("Reply idempotency key")) {
    throw new InvalidCustomerReplyReplayError();
  }
  if (error?.code === "42501") throw new CustomerReplyForbiddenError();
  if (error?.code === "P0002") throw new PublicTicketNotFoundError();
  throw new Error("Customer reply command failed");
}

/** Signed-in customer reopen with a required reason (migration 058). */
export async function reopenTicketAsCustomer(args: {
  supabase: SupabaseClient;
  ticketId: string;
  actorId: string;
  body: string;
  idempotencyKey: string;
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "reopen_ticket_as_customer_atomic",
    {
      p_input: {
        ticket_id: args.ticketId,
        actor_id: args.actorId,
        body: args.body,
        idempotency_key: args.idempotencyKey,
      },
    }
  );
  if (error || typeof data !== "string") throwReplyError(error);
  return data;
}

/** Guest reply authorized by the share token (migration 058). */
export async function recordGuestTicketReply(args: {
  supabase: SupabaseClient;
  ticketNo: string;
  secureToken: string;
  body: string;
  reopen: boolean;
  idempotencyKey: string;
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "record_guest_ticket_reply_atomic",
    {
      p_input: {
        ticket_no: args.ticketNo,
        secure_token: args.secureToken,
        body: args.body,
        reopen: args.reopen,
        idempotency_key: args.idempotencyKey,
      },
    }
  );
  if (error || typeof data !== "string") throwReplyError(error);
  return data;
}
