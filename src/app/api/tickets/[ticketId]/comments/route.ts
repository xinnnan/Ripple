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
  author_id: z.string().uuid().optional(),
  body: z.string().min(1),
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

    // Non-internal users can never post internal comments — silently
    // downgrade to customer-visible.
    const isInternal = auth.role === "admin" || auth.role === "engineer";
    const safeVisibility = isInternal ? data.visibility : "customer";

    const { data: comment, error } = await supabase
      .from("ticket_comments")
      .insert({
        ticket_id: ticketId,
        author_id: data.author_id || null,
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
      ticket_id: ticketId,
      event_type: "comment_added",
      old_value: null,
      new_value: safeVisibility,
      actor_id: data.author_id || null,
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
