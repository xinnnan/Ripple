import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireInternal, getAuthUser } from "@/lib/supabase/auth-helpers";
import { getUserScope, scopeTickets } from "@/lib/supabase/scope";
import { updateMasterMessage } from "@/lib/slack/sync";
import { sendTicketResolved } from "@/lib/email/send";
import { resolveTicketQuery } from "@/lib/tickets/lookup";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ ticketId: string }>;
}

const patchTicketSchema = z.object({
  status: z.enum([
    "new",
    "assigned",
    "in_progress",
    "waiting_customer",
    "waiting_droplet",
    "resolved",
    "closed",
    "reopened",
  ]).optional(),
  severity: z.enum(["P1", "P2", "P3", "P4"]).optional(),
  owner_id: z.string().uuid().optional(),
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
    const body = await request.json();
    const data = patchTicketSchema.parse(body);

    const supabase = createAdminClient();

    // Fetch current ticket for event logging.
    const { data: currentTicket } = await resolveTicketQuery(
      supabase.from("tickets").select("status, severity, owner_id"),
      ticketId
    ).maybeSingle();

    if (!currentTicket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Build update object
    const update: Record<string, unknown> = {};
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

    // Set resolved_at when resolving
    if (data.status === "resolved" && currentTicket.status !== "resolved") {
      update.resolved_at = new Date().toISOString();
    }
    // Set closed_at when closing
    if (data.status === "closed" && currentTicket.status !== "closed") {
      update.closed_at = new Date().toISOString();
    }

    // Use the same id-or-ticket_no lookup that we did above.
    const { data: ticket, error } = await resolveTicketQuery(
      supabase.from("tickets").update(update),
      ticketId
    )
      .select(
        `
        *,
        customer:customers(id, name),
        site:sites(id, site_name, site_code, slack_channel_id),
        owner:users!tickets_owner_id_fkey(id, full_name)
      `
      )
      .single();

    if (error) {
      console.error("Failed to update ticket:", error);
      return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
    }

    // Log events for changes. The events.ticket_id column is a UUID FK
    // to tickets.id, so we must use the resolved UUID (not the URL
    // param, which might be a human-readable ticket_no like RPL-000005).
    // The actor_id is always auth.userId — never the body, which would
    // let an internal user blame someone else in the audit log.
    const ticketUuid = ticket.id as string;
    const actorId = auth.userId;
    const events: { ticket_id: string; event_type: string; old_value: string | null; new_value: string | null; actor_id: string | null }[] = [];

    if (data.status && data.status !== currentTicket.status) {
      events.push({
        ticket_id: ticketUuid,
        event_type: "status_changed",
        old_value: currentTicket.status,
        new_value: data.status,
        actor_id: actorId,
      });
    }
    if (data.severity && data.severity !== currentTicket.severity) {
      events.push({
        ticket_id: ticketUuid,
        event_type: "severity_changed",
        old_value: currentTicket.severity,
        new_value: data.severity,
        actor_id: actorId,
      });
    }
    if (data.owner_id && data.owner_id !== currentTicket.owner_id) {
      events.push({
        ticket_id: ticketUuid,
        event_type: "owner_assigned",
        old_value: currentTicket.owner_id,
        new_value: data.owner_id,
        actor_id: actorId,
      });
    }

    if (events.length > 0) {
      await supabase.from("ticket_events").insert(events);
    }

    // Sync the change back to Slack so the master card in the channel
    // stays in lockstep with the database. The function looks up the
    // most recent master message from `slack_messages`; if none is
    // recorded (e.g. ticket was created before Sprint 2), it silently
    // no-ops and the ticket still updates.
    const syncResult = await updateMasterMessage(ticket as import("@/types/ticket").Ticket);
    if (!syncResult.ok) {
      // Non-fatal: log and continue. Web portal is the source of truth.
      console.warn(
        `[PATCH /api/tickets/[id]] Slack sync skipped: ${syncResult.reason ?? "unknown"}` +
          (syncResult.error ? ` (${syncResult.error})` : "")
      );
    }

    // Send a resolution email when the status flips to "resolved".
    // Re-read submitter_email + customer_visible_summary from the
    // updated ticket to make sure we have the latest values.
    if (data.status === "resolved" && currentTicket.status !== "resolved") {
      const submitterEmail = ticket.submitter_email as string | null;
      const summary =
        (ticket.customer_visible_summary as string | null) ??
        "Your ticket has been resolved. Please reply if anything is still off.";
      if (submitterEmail) {
        const emailRes = await sendTicketResolved({
          to: submitterEmail,
          ticketNo: ticket.ticket_no as string,
          title: ticket.title as string,
          secureToken: ticket.secure_token as string,
          resolutionSummary: summary,
        });
        if (!emailRes.sent) {
          console.warn(
            `[PATCH /api/tickets/[id]] resolution email not sent: ${emailRes.reason}` +
              (emailRes.error ? ` (${emailRes.error})` : "")
          );
        }
      }
    }

    return NextResponse.json({ ticket });
  } catch (error) {
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
