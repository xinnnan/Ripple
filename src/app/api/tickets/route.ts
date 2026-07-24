import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getUserScope, scopeTickets } from "@/lib/supabase/scope";
import { sendTicketConfirmation } from "@/lib/email/send";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
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
    // Auth is optional here: the public /submit form is unauthed.
    // But if the caller IS logged in, we MUST use auth.userId as
    // created_by, never the body's value. A customer could otherwise
    // pass created_by=<engineer uuid> and have the ticket appear
    // engineer-created.
    //
    // getAuthUser returns { error, status } if there's no session
    // — we treat that as "unauthed, allow no created_by". A non-2xx
    // response there is a real auth failure (which shouldn't happen
    // for a guest submit, but if it does we fall through to null).
    const auth = await getAuthUser();
    const isAuthed = !("error" in auth);

    // Rate-limit unauthed submissions. Authed users go through
    // the full RBAC path; their volume is bounded by the org
    // size. The submit form is open to anyone with a browser, so
    // we cap at 10 / minute / IP. (Catches accidental double-
    // clicks + naive bot scripts; NOT a CAPTCHA substitute. See
    // AGENTS.md "Known issues" for the path to a hardened
    // solution.)
    if (!isAuthed) {
      const ip = getClientIp(request.headers);
      const rl = rateLimit({
        key: `submit:${ip}`,
        limit: 10,
        windowMs: 60_000,
      });
      if (!rl.allowed) {
        return NextResponse.json(
          { error: "Too many submissions. Please try again in a minute." },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
            },
          }
        );
      }
    }

    const body = await request.json();
    const data = createTicketSchema.parse(body);

    const createdBy = isAuthed && !("error" in auth) ? auth.userId : null;

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

    // Security: if the caller passed BOTH site_id and customer_id
    // explicitly, we MUST verify they match the row in DB. Otherwise
    // a malicious caller could post { site_id: <SITE_A>,
    // customer_id: <CUST_B> } and create a ticket that says it's for
    // SITE_A but is attributed to CUST_B. The site_code path is
    // safe because customer_id is derived from the same DB row.
    if (data.site_id && data.customer_id) {
      const { data: siteRow, error: siteErr } = await supabase
        .from("sites")
        .select("customer_id")
        .eq("id", siteId)
        .maybeSingle();
      if (siteErr) {
        console.error("POST /api/tickets site lookup failed:", siteErr);
        return NextResponse.json(
          { error: "Internal server error" },
          { status: 500 }
        );
      }
      if (!siteRow) {
        return NextResponse.json(
          { error: "site_id not found" },
          { status: 400 }
        );
      }
      if (siteRow.customer_id !== customerId) {
        return NextResponse.json(
          { error: "site_id and customer_id do not match" },
          { status: 400 }
        );
      }
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
      created_by: createdBy,
      submitter_name: data.submitter_name,
      submitter_email: data.submitter_email,
      submitter_phone: data.submitter_phone,
    });

    // Fire-and-forget confirmation email. Never fails the request —
    // if RESEND_API_KEY is missing or Resend errors, the customer
    // still has their ticket_no + secure_token in the response.
    if (data.submitter_email) {
      const customerName =
        (result.ticket.customer as { name?: string } | undefined)?.name ??
        "Customer";
      const siteName =
        (result.ticket.site as { site_name?: string } | undefined)?.site_name ??
        "Site";
      const emailRes = await sendTicketConfirmation({
        to: data.submitter_email,
        ticketNo: result.ticket_no,
        title: data.title,
        secureToken: result.secure_token,
        customerName,
        siteName,
      });
      if (!emailRes.sent) {
        console.warn(
          `[POST /api/tickets] confirmation email not sent: ${emailRes.reason}` +
            (emailRes.error ? ` (${emailRes.error})` : "")
        );
      }
    }

    return NextResponse.json(
      {
        // `id` is the UUID — the form needs it to attach files via
        // /api/upload. `secure_token` is the unauthed proof-of-ownership
        // token for the attachment upload (and for the /t/[token] page).
        id: result.ticket.id,
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

export async function GET(request: NextRequest) {
  try {
    // Auth required. Without this the admin client would happily
    // dump every ticket across every customer — a tenant leak.
    // (Pre-Sprint-2 this endpoint was open.)
    const auth = await getAuthUser();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const scope = await getUserScope();
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    // Tenant scope: internal users see everything; everyone else
    // is limited to the site_ids in their scope (see lib/supabase/scope.ts).
    query = scopeTickets(query, scope);

    const status = searchParams.get("status");
    if (status) query = query.eq("status", status);

    const severity = searchParams.get("severity");
    if (severity) query = query.eq("severity", severity);

    // Customer/site filters are only honored when the caller is
    // internal — external users already have their scope applied, and
    // trusting a customer_id/site_id from the querystring would let a
    // customer_manager from org A read org B by guessing ids.
    if (scope.isInternal) {
      const customer_id = searchParams.get("customer_id");
      if (customer_id) query = query.eq("customer_id", customer_id);

      const site_id = searchParams.get("site_id");
      if (site_id) query = query.eq("site_id", site_id);
    }

    // Clamp limit to a sane range to prevent someone hammering the
    // endpoint with limit=1000000.
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1),
      200
    );
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
