import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getUserScope, scopeTickets } from "@/lib/supabase/scope";
import { resolveTicketQuery } from "@/lib/tickets/lookup";
import {
  InvalidTicketCommentReplayError,
  recordTicketCommentWithSla,
} from "@/lib/tickets/mutations";
import { dispatchTicketOutboxBestEffort } from "@/lib/tickets/outbox";
import { z } from "zod";
import {
  EXTERNAL_TICKET_COMMENT_SELECT,
  INTERNAL_TICKET_COMMENT_SELECT,
} from "@/lib/resource-projections";
import { TICKET_COMMENT_MAX_LENGTH } from "@/lib/tickets/input-contract";
import {
  generateTicketIdempotencyKey,
  normalizeTicketIdempotencyKey,
  TICKET_IDEMPOTENCY_KEY_HEADER,
} from "@/lib/tickets/idempotency";

interface RouteContext {
  params: Promise<{ ticketId: string }>;
}

const createCommentSchema = z.object({
  // author_id is intentionally NOT accepted — the route forces
  // author_id = auth.userId to prevent impersonation. See POST
  // handler for the full reasoning.
  body: z.string().trim().min(1).max(TICKET_COMMENT_MAX_LENGTH),
  visibility: z.enum(["customer", "internal"]).default("customer"),
}).strict();

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const auth = await getAuthUser();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { ticketId } = await context.params;
    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const visibility = searchParams.get("visibility");

    // Verify the user can see this ticket (defence in depth)
    const scope = await getUserScope();
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    let ticketQuery = supabase
      .from("tickets")
      .select("id");
    ticketQuery = scopeTickets(
      resolveTicketQuery(ticketQuery, ticketId),
      scope
    );
    const { data: ticket } = await ticketQuery.maybeSingle();
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    let query = supabase
      .from("ticket_comments")
      .select(
        scope.isInternal
          ? INTERNAL_TICKET_COMMENT_SELECT
          : EXTERNAL_TICKET_COMMENT_SELECT
      )
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: true });

    // Non-internal users can never see internal comments.
    if (!scope.isInternal) {
      query = query.eq("visibility", "customer");
    } else if (visibility) {
      query = query.eq("visibility", visibility);
    }

    const { data: comments, error } = await query;

    if (error) {
      return NextResponse.json({ error: "Failed to fetch comments" }, { status: 500 });
    }

    return NextResponse.json({ comments });
  } catch (error) {
    console.error("Get comments error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const auth = await getAuthUser();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { ticketId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const data = createCommentSchema.parse(body);
    const suppliedIdempotencyKey = request.headers.get(
      TICKET_IDEMPOTENCY_KEY_HEADER
    );
    const idempotencyKey =
      suppliedIdempotencyKey === null
        ? generateTicketIdempotencyKey()
        : normalizeTicketIdempotencyKey(suppliedIdempotencyKey);
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "Invalid Idempotency-Key header" },
        {
          status: 400,
          headers: { "Cache-Control": "private, no-store" },
        }
      );
    }

    const supabase = createAdminClient();

    // Verify the caller can see this ticket (defence in depth —
    // the ticket_id FK would catch a non-existent one, but this also
    // enforces tenant scope for non-internal callers).
    const scope = await getUserScope();
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: ticket, error: ticketErr } = await resolveTicketQuery(
      supabase.from("tickets").select(
        "id, site_id"
      ),
      ticketId
    ).maybeSingle();
    if (ticketErr) {
      console.error("POST /api/tickets/[ticketId]/comments lookup failed:", {
        code: ticketErr.code,
      });
      return NextResponse.json({ error: "Failed to load ticket" }, { status: 500 });
    }
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    if (!scope.isInternal) {
      // Non-internal callers can only post on tickets in their scope.
      // We do a lightweight check by comparing site_id to scope.siteIds.
      // The full ticket row is fetched here so we don't re-query.
      const ticketSite = (ticket as { site_id?: string }).site_id;
      if (!ticketSite || !scope.siteIds.includes(ticketSite)) {
        return NextResponse.json(
          { error: "Ticket not in your scope" },
          { status: 403 }
        );
      }
    }

    // Non-internal users can never post internal comments — silently
    // downgrade to customer-visible.
    const isInternal = scope.isInternal;
    const safeVisibility = isInternal ? data.visibility : "customer";

    // Security: author_id must be the calling user. A non-internal
    // caller passing { author_id: <engineer uuid> } would otherwise
    // have the comment appear as if the engineer wrote it — a
    // classic impersonation bug. The trigger handle_new_user() in
    // 011 also mirrors auth.users to public.users, so auth.userId
    // (the JWT sub) is always a valid public.users.id.
    //
    // If a future feature wants to "post on behalf of" someone
    // (e.g. a triage bot), that path should be internal-only and
    // require an explicit `on_behalf_of` flag.
    const authorId = auth.userId;

    // ticketId might be a human-readable ticket_no like RPL-000005.
    // We resolved it to `ticket.id` (UUID) above for the scope check.
    // The insert needs the UUID, not the URL param.
    // Migration 048 wraps migration 026 so the comment, replay receipt,
    // timeline, audit entry, first-response milestone, and customer-visible
    // Slack event commit together. Only a human, internal-authored,
    // customer-visible response can satisfy the milestone.
    const commentId = await recordTicketCommentWithSla({
      supabase,
      ticketId: (ticket as { id: string }).id,
      actorId: authorId,
      body: data.body,
      visibility: safeVisibility,
      // The route, not the caller, owns attribution. A browser request cannot
      // claim to be a Slack or email message.
      source: "web",
      isAutomated: false,
      idempotencyKey,
    });

    // Migration 048 commits one customer-visible Slack reply event with the
    // comment. Immediate delivery is best-effort; the leased worker retains
    // responsibility if Slack or the request path is unavailable.
    await dispatchTicketOutboxBestEffort({
      aggregateId: (ticket as { id: string }).id,
    });

    const { data: comment, error } = await supabase
      .from("ticket_comments")
      .select(
        isInternal
          ? INTERNAL_TICKET_COMMENT_SELECT
          : EXTERNAL_TICKET_COMMENT_SELECT
      )
      .eq("id", commentId)
      .single();

    if (error) {
      // The comment/timeline/SLA command has already committed. Preserve its
      // success status when only response hydration is degraded.
      console.error(
        "POST /api/tickets/[ticketId]/comments hydration failed:",
        { code: error.code }
      );
      return NextResponse.json(
        {
          comment: { id: commentId, ticket_id: ticket.id },
          warning: "Comment added; detail refresh is temporarily unavailable",
        },
        {
          status: 201,
          headers: {
            "Cache-Control": "private, no-store",
            [TICKET_IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
          },
        }
      );
    }

    return NextResponse.json(
      { comment },
      {
        status: 201,
        headers: {
          "Cache-Control": "private, no-store",
          [TICKET_IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
        },
      }
    );
  } catch (error) {
    if (error instanceof InvalidTicketCommentReplayError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: 409,
          headers: { "Cache-Control": "private, no-store" },
        }
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("POST /api/tickets/[ticketId]/comments failed:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
