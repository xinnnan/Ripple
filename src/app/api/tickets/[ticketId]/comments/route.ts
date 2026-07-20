import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getUserScope, scopeTickets } from "@/lib/supabase/scope";
import { resolveTicketQuery } from "@/lib/tickets/lookup";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ ticketId: string }>;
}

const createCommentSchema = z.object({
  // author_id is intentionally NOT accepted — the route forces
  // author_id = auth.userId to prevent impersonation. See POST
  // handler for the full reasoning.
  body: z.string().min(1).max(10000),
  visibility: z.enum(["customer", "internal"]).default("customer"),
  source: z.enum(["slack", "web", "email"]).default("web"),
});

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
      .select("*, author:users(full_name, email, role)")
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
    const body = await request.json();
    const data = createCommentSchema.parse(body);

    const supabase = createAdminClient();

    // Verify the caller can see this ticket (defence in depth —
    // the ticket_id FK would catch a non-existent one, but this also
    // enforces tenant scope for non-internal callers).
    const scope = await getUserScope();
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: ticket, error: ticketErr } = await resolveTicketQuery(
      supabase.from("tickets").select("id, site_id"),
      ticketId
    ).maybeSingle();
    if (ticketErr) {
      console.error("Ticket lookup failed:", ticketErr);
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
    const isInternal = auth.role === "admin" || auth.role === "engineer";
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
    const { data: comment, error } = await supabase
      .from("ticket_comments")
      .insert({
        ticket_id: (ticket as { id: string }).id,
        author_id: authorId,
        body: data.body,
        visibility: safeVisibility,
        source: data.source,
      })
      .select("*, author:users(full_name, email)")
      .single();

    if (error) {
      console.error("Failed to create comment:", error);
      return NextResponse.json({ error: "Failed to create comment" }, { status: 500 });
    }

    // Log event
    await supabase.from("ticket_events").insert({
      ticket_id: (ticket as { id: string }).id,
      event_type: "comment_added",
      old_value: null,
      new_value: safeVisibility,
      actor_id: authorId,
    });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Create comment error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
