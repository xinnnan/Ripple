import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/rate-limit";
import { dispatchTicketOutboxBestEffort } from "@/lib/tickets/outbox";
import { TICKET_COMMENT_MAX_LENGTH } from "@/lib/tickets/input-contract";
import { TICKET_IDEMPOTENCY_KEY_HEADER } from "@/lib/tickets/idempotency";
import {
  consumePublicTicketLimit,
  findPublicTicketId,
  PUBLIC_TICKET_NO_PATTERN,
  PUBLIC_TICKET_TOKEN_PATTERN,
} from "@/lib/tickets/public-access";
import {
  InvalidCustomerReplyReplayError,
  normalizeCustomerReplyKey,
  PublicTicketNotFoundError,
  recordGuestTicketReply,
  TicketNotReopenableError,
} from "@/lib/tickets/customer-replies";

export const dynamic = "force-dynamic";

const guestReplySchema = z
  .object({
    // The token travels in the body so it never lands in URL logs.
    token: z.string().regex(PUBLIC_TICKET_TOKEN_PATTERN),
    body: z.string().trim().min(1).max(TICKET_COMMENT_MAX_LENGTH),
    reopen: z.boolean().default(false),
  })
  .strict();

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", ...headers },
  });
}

/**
 * POST /api/public/tickets/[ticketNo]/replies — a guest (no account) answers
 * or reopens their ticket from the share link. Migration 058's command
 * re-verifies the token under a row lock and owns replay safety.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticketNo: string }> }
) {
  const { ticketNo } = await params;
  if (!PUBLIC_TICKET_NO_PATTERN.test(ticketNo)) {
    return json({ error: "A valid ticket link is required" }, 400);
  }

  const idempotencyKey = normalizeCustomerReplyKey(
    request.headers.get(TICKET_IDEMPOTENCY_KEY_HEADER)
  );
  if (!idempotencyKey) {
    return json({ error: "Invalid Idempotency-Key header" }, 400);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = guestReplySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "Enter a reply between 1 and 10,000 characters." }, 400);
  }

  const supabase = createAdminClient();
  try {
    const limit = await consumePublicTicketLimit({
      supabase,
      purpose: "guest-reply",
      clientIp: getClientIp(request.headers),
    });
    if (!limit.allowed) {
      return json(
        { error: "Too many replies. Please wait a few minutes and try again." },
        429,
        { "Retry-After": String(limit.retryAfterSeconds) }
      );
    }
  } catch {
    return json({ error: "Replies are temporarily unavailable" }, 503);
  }

  try {
    const ticket = await findPublicTicketId(supabase, ticketNo, parsed.data.token);
    if (!ticket) return json({ error: "Ticket not found" }, 404);

    const commentId = await recordGuestTicketReply({
      supabase,
      ticketNo,
      secureToken: parsed.data.token,
      body: parsed.data.body,
      reopen: parsed.data.reopen,
      idempotencyKey,
    });

    await dispatchTicketOutboxBestEffort({ aggregateId: ticket.id });

    return json({ comment: { id: commentId } }, 201, {
      [TICKET_IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
    });
  } catch (error) {
    if (
      error instanceof TicketNotReopenableError ||
      error instanceof InvalidCustomerReplyReplayError
    ) {
      return json({ error: error.message }, 409);
    }
    if (error instanceof PublicTicketNotFoundError) {
      return json({ error: "Ticket not found" }, 404);
    }
    console.error("Guest ticket reply failed:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "Replies are temporarily unavailable" }, 503);
  }
}
