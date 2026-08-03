import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireInternal, getAuthUser } from "@/lib/supabase/auth-helpers";
import { getUserScope, scopeTickets } from "@/lib/supabase/scope";
import { resolveTicketQuery } from "@/lib/tickets/lookup";
import {
  applyTicketPatchWithSla,
  InvalidTicketTransitionError,
  type TicketPatch,
} from "@/lib/tickets/mutations";
import {
  dispatchTicketOutboxBestEffort,
} from "@/lib/tickets/outbox";
import { TICKET_STATUSES } from "@/types/ticket";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ ticketId: string }>;
}

const patchTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  severity: z.enum(["P1", "P2", "P3", "P4"]).optional(),
  owner_id: z.string().uuid().nullable().optional(),
  customer_visible_summary: z.string().optional(),
  internal_summary: z.string().optional(),
  root_cause_category: z.string().optional(),
  follow_up_needed: z.boolean().optional(),
  // NOTE: actor_id is intentionally NOT accepted from the body.
  // The route always uses auth.userId for the ticket_events
  // actor_id. A previous version trusted the body field, which let
  // an internal user blame a different engineer in the audit log
  // by passing actor_id=<other_user_id>. The UI used to send
  // currentUserId; that's still the value, it just comes from the
  // JWT now instead of the body.
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one ticket field is required",
});

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { ticketId } = await context.params;

    // Auth required. Use the scope to filter out tickets the user can't see.
    const auth = await getAuthUser();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const scope = await getUserScope();
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createAdminClient();

    // Accept either the ticket UUID or the human-readable ticket_no.
    // (See lib/tickets/lookup.ts for why the .or() trick doesn't work.)
    //
    // We also strip a few fields the API must never echo to a
    // non-internal caller:
    //   - secure_token: the public URL token. If leaked, anyone with
    //     the token could view the ticket via /t/[ticketId]?token=...
    //     We already return it via the customer_visible route
    //     separately; this endpoint doesn't need it.
    //   - internal_summary, root_cause_category: engineer-only.
    //   - submitter_email, submitter_phone: PII — the customer already
    //     sees them on the form they submitted, no need to echo via
    //     the API on subsequent reads.
    const baseQuery = supabase
      .from("tickets")
      .select(
        `
        id, ticket_no, title, description, request_type, severity, status,
        impact, asset_id, area, source, customer_id, site_id, owner_id,
        created_by, customer_visible_summary,
        created_at, updated_at, resolved_at, closed_at,
        customer:customers(id, name),
        site:sites(id, site_name, site_code, slack_channel_id),
        owner:users!tickets_owner_id_fkey(id, full_name),
        creator:users!tickets_created_by_fkey(id, full_name)
      `
      );
    const query = scopeTickets(
      resolveTicketQuery(baseQuery, ticketId),
      scope
    );

    const { data: ticket, error } = await query.maybeSingle();

    if (error || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Internal-only fields are added back for admin / engineer.
    // Non-internal callers (customer, customer_manager) get the
    // sanitized view.
    if (scope.isInternal) {
      const internal = await supabase
        .from("tickets")
        .select(
          "internal_summary, root_cause_category, follow_up_needed, secure_token, submitter_email, submitter_phone"
        )
        .eq("id", (ticket as { id: string }).id)
        .maybeSingle();
      if (internal.data) {
        Object.assign(ticket as Record<string, unknown>, internal.data);
      }
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    console.error("Get ticket error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    // Only internal users (admin / engineer) can modify a ticket.
    const auth = await requireInternal();
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
    const data = patchTicketSchema.parse(body);

    const supabase = createAdminClient();

    // Resolve the ticket once so the database command receives the UUID even
    // when the URL uses a human-readable RPL- ticket number.
    const { data: currentTicket } = await resolveTicketQuery(
      supabase.from("tickets").select(
        "id, status, severity, owner_id"
      ),
      ticketId
    ).maybeSingle();

    if (!currentTicket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Build update object
    const update: TicketPatch = {};
    if (data.status !== undefined) update.status = data.status;
    if (data.severity !== undefined) update.severity = data.severity;
    if (data.owner_id !== undefined) update.owner_id = data.owner_id;
    if (data.customer_visible_summary !== undefined)
      update.customer_visible_summary = data.customer_visible_summary;
    if (data.internal_summary !== undefined)
      update.internal_summary = data.internal_summary;
    if (data.root_cause_category !== undefined)
      update.root_cause_category = data.root_cause_category;
    if (data.follow_up_needed !== undefined)
      update.follow_up_needed = data.follow_up_needed;

    // Migration 026 owns the transaction boundary: ticket data, milestone
    // timestamps, ticket_events, and audit_logs either all commit or all roll
    // back. Status changes intentionally never satisfy First Response.
    await applyTicketPatchWithSla({
      supabase,
      ticketId: currentTicket.id,
      actorId: auth.userId,
      patch: update,
      source: "web",
    });

    const { data: ticket, error } = await supabase
      .from("tickets")
      .select(
        `
        *,
        customer:customers(id, name),
        site:sites(id, site_name, site_code, slack_channel_id),
        owner:users!tickets_owner_id_fkey(id, full_name)
      `
      )
      .eq("id", currentTicket.id)
      .single();

    if (error) {
      console.error("Failed to update ticket:", error);
      return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
    }

    // Migration 033 enqueued delivery work in the same transaction as the
    // ticket mutation. Try it immediately for responsive UI, while leaving
    // any failure durable for the scheduled lease-based worker.
    await dispatchTicketOutboxBestEffort({
      aggregateId: currentTicket.id,
    });

    return NextResponse.json({ ticket });
  } catch (error) {
    if (error instanceof InvalidTicketTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Update ticket error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
