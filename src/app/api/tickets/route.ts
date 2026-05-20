import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSecureToken, formatTicketNo } from "@/lib/utils";
import { z } from "zod";

const createTicketSchema = z.object({
  customer_id: z.string().uuid().optional(),
  site_id: z.string().uuid().optional(),
  site_code: z.string().optional(),
  source: z.enum(["slack", "web", "email", "internal"]),
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  request_type: z.enum([
    "incident",
    "service_request",
    "question",
    "change_request",
    "parts_rma",
    "deployment_issue",
    "training_documentation",
  ]),
  severity: z.enum(["P1", "P2", "P3", "P4"]),
  impact: z
    .enum([
      "safety",
      "production_stopped",
      "production_slowed",
      "single_asset",
      "no_impact",
    ])
    .optional(),
  asset_id: z.string().optional(),
  area: z.string().optional(),
  created_by: z.string().optional(),
  submitter_name: z.string().optional(),
  submitter_email: z.string().email().optional(),
  submitter_phone: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = createTicketSchema.parse(body);

    const supabase = createAdminClient();

    // Resolve site from site_code if provided
    let siteId = data.site_id;
    let customerId = data.customer_id;

    if (!siteId && data.site_code) {
      const { data: site } = await supabase
        .from("sites")
        .select("id, customer_id")
        .eq("site_code", data.site_code.toUpperCase())
        .single();

      if (site) {
        siteId = site.id;
        customerId = site.customer_id;
      }
    }

    if (!siteId || !customerId) {
      return NextResponse.json(
        { error: "Could not determine site. Please provide a valid site_id or site_code." },
        { status: 400 }
      );
    }

    // Get next ticket number
    const { data: lastTicket } = await supabase
      .from("tickets")
      .select("ticket_no")
      .order("ticket_no", { ascending: false })
      .limit(1)
      .single();

    const lastNum = lastTicket
      ? parseInt(lastTicket.ticket_no.replace("RPL-", ""), 10)
      : 0;
    const ticketNo = formatTicketNo(lastNum + 1);

    // Create ticket
    const secureToken = generateSecureToken();

    const { data: ticket, error } = await supabase
      .from("tickets")
      .insert({
        ticket_no: ticketNo,
        customer_id: customerId,
        site_id: siteId,
        source: data.source,
        title: data.title,
        description: data.description,
        request_type: data.request_type,
        severity: data.severity,
        status: "new",
        impact: data.impact || null,
        asset_id: data.asset_id || null,
        area: data.area || null,
        created_by: data.created_by || null,
        secure_token: secureToken,
      })
      .select(
        `
        *,
        customer:customers(id, name),
        site:sites(id, site_name, site_code, slack_channel_id)
      `
      )
      .single();

    if (error) {
      console.error("Failed to create ticket:", error);
      return NextResponse.json(
        { error: "Failed to create ticket" },
        { status: 500 }
      );
    }

    // Create ticket event
    await supabase.from("ticket_events").insert({
      ticket_id: ticket.id,
      event_type: "ticket_created",
      old_value: null,
      new_value: "new",
      actor_id: data.created_by || null,
    });

    // TODO: Post to Slack site channel
    // TODO: Send confirmation email

    return NextResponse.json(
      {
        ticket_no: ticket.ticket_no,
        secure_token: ticket.secure_token,
        message: "Ticket created successfully",
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Create ticket error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const supabase = createAdminClient();

    let query = supabase
      .from("tickets")
      .select(
        `
        *,
        customer:customers(id, name),
        site:sites(id, site_name, site_code),
        owner:users!tickets_owner_id_fkey(id, full_name)
      `
      )
      .order("created_at", { ascending: false });

    // Filters
    const status = searchParams.get("status");
    if (status) query = query.eq("status", status);

    const severity = searchParams.get("severity");
    if (severity) query = query.eq("severity", severity);

    const customer_id = searchParams.get("customer_id");
    if (customer_id) query = query.eq("customer_id", customer_id);

    const site_id = searchParams.get("site_id");
    if (site_id) query = query.eq("site_id", site_id);

    const limit = parseInt(searchParams.get("limit") || "50");
    query = query.limit(limit);

    const { data: tickets, error } = await query;

    if (error) {
      console.error("Failed to fetch tickets:", error);
      return NextResponse.json(
        { error: "Failed to fetch tickets" },
        { status: 500 }
      );
    }

    return NextResponse.json({ tickets });
  } catch (error) {
    console.error("Get tickets error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
