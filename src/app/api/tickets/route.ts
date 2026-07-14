import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createTicketCore,
  resolveSiteByCode,
} from "@/lib/tickets/create";

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

    // Resolve site: prefer explicit ids, fall back to site_code lookup.
    let siteId = data.site_id;
    let customerId = data.customer_id;

    if (!siteId && data.site_code) {
      const site = await resolveSiteByCode(supabase, data.site_code);
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

    const result = await createTicketCore({
      customer_id: customerId,
      site_id: siteId,
      source: data.source,
      title: data.title,
      description: data.description,
      request_type: data.request_type,
      severity: data.severity,
      impact: data.impact,
      asset_id: data.asset_id,
      area: data.area,
      created_by: data.created_by,
    });

    // TODO Sprint 2: send confirmation email via Resend when submitter_email
    // is present and RESEND_API_KEY is set. Wired in Phase 2.2.
    // if (data.submitter_email && process.env.RESEND_API_KEY) {
    //   await sendTicketConfirmation({ to, ticketNo, ... });
    // }

    return NextResponse.json(
      {
        ticket_no: result.ticket_no,
        secure_token: result.secure_token,
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
