import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import {
  canAccessSite,
  getUserScope,
  scopeTickets,
} from "@/lib/supabase/scope";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import {
  createTicketCore,
  resolveSiteByCode,
} from "@/lib/tickets/create";
import {
  SITE_CODE_MAX_LENGTH,
  SITE_CODE_PATTERN,
} from "@/lib/sites/site-code";
import {
  buildRateLimitBucketKey,
  consumeDistributedRateLimit,
  getRetryAfterSeconds,
} from "@/lib/distributed-rate-limit";
import { parseTicketApiListFilters } from "@/lib/tickets/api-list-filters";
import {
  EXTERNAL_TICKET_LIST_SELECT,
  INTERNAL_TICKET_LIST_SELECT,
} from "@/lib/resource-projections";

const createTicketSchema = z.object({
  customer_id: z.string().uuid().optional(),
  site_id: z.string().uuid().optional(),
  site_code: z
    .string()
    .trim()
    .min(1)
    .max(SITE_CODE_MAX_LENGTH)
    .regex(SITE_CODE_PATTERN)
    .optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(20_000),
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
  asset_id: z.string().trim().max(500).optional(),
  area: z.string().trim().max(500).optional(),
  submitter_name: z.string().trim().max(200).optional(),
  submitter_email: z.string().trim().email().max(320).optional(),
  submitter_phone: z.string().trim().max(50).optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Auth is optional here: the public /submit form is unauthed.
    // But if the caller IS logged in, we MUST use auth.userId as
    // created_by, never the body's value. A customer could otherwise
    // pass created_by=<engineer uuid> and have the ticket appear
    // engineer-created.
    //
    // A missing session is the public guest path. An authenticated but
    // inactive/invalid profile is a real authorization failure and must not
    // be silently downgraded to a guest submission.
    const authResult = await getAuthUser();
    if ("error" in authResult && authResult.status !== 401) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status }
      );
    }
    const auth = "error" in authResult ? null : authResult;
    const isAuthed = auth !== null;
    const supabase = createAdminClient();

    // Rate-limit unauthed submissions. The process-local counter is a cheap
    // first layer; migration 046's atomic command enforces the same boundary
    // across serverless instances and cold starts. This is still not a CAPTCHA
    // or proof that the caller belongs to the submitted site.
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

      try {
        const distributedLimit = await consumeDistributedRateLimit({
          supabase,
          bucketKey: buildRateLimitBucketKey("ticket-submit", ip),
          limit: 10,
          windowSeconds: 60,
        });
        if (!distributedLimit.allowed) {
          return NextResponse.json(
            { error: "Too many submissions. Please try again in a minute." },
            {
              status: 429,
              headers: {
                "Retry-After": String(
                  getRetryAfterSeconds(distributedLimit.resetAt)
                ),
              },
            }
          );
        }
      } catch (error) {
        console.error("POST /api/tickets rate limit unavailable:", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
        return NextResponse.json(
          { error: "Ticket submission is temporarily unavailable" },
          { status: 503 }
        );
      }
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const data = createTicketSchema.parse(body);

    const createdBy = auth?.userId ?? null;

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

    if (!siteId) {
      return NextResponse.json(
        { error: "Could not determine site. Please provide a valid site_id or site_code." },
        { status: 400 }
      );
    }

    // Always derive the tenant from the active site row. Never trust a client
    // supplied customer_id independently from its site_id.
    const { data: siteRow, error: siteErr } = await supabase
      .from("sites")
      .select("customer_id, customer:customers!inner(status)")
      .eq("id", siteId)
      .eq("status", "active")
      .in("customer.status", ["active", "trial"])
      .maybeSingle();
    if (siteErr) {
      console.error("POST /api/tickets site lookup failed:", siteErr);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
    if (!siteRow) {
      return NextResponse.json({ error: "site_id not found" }, { status: 400 });
    }
    const resolvedCustomerId = siteRow.customer_id as string;
    if (customerId && resolvedCustomerId !== customerId) {
      return NextResponse.json(
        { error: "site_id and customer_id do not match" },
        { status: 400 }
      );
    }

    // Authenticated external callers may create only within their current
    // active-site scope. Inactive accounts were rejected above rather than
    // silently downgraded to the public guest path.
    if (auth) {
      const scope = await getUserScope();
      if (!scope) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!canAccessSite(scope, siteId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const result = await createTicketCore({
      customer_id: resolvedCustomerId,
      site_id: siteId,
      // Provenance belongs to the server endpoint, never the request body.
      // Slack and future email intake call createTicketCore from their own
      // verified server-side handlers.
      source: "web",
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
    const parsedFilters = parseTicketApiListFilters(searchParams);
    if (!parsedFilters.success) {
      return NextResponse.json(
        { error: "Invalid ticket list filters" },
        { status: 400 }
      );
    }
    const filters = parsedFilters.data;

    if (
      filters.customerId &&
      !scope.isInternal &&
      scope.customerId !== filters.customerId
    ) {
      return NextResponse.json(
        { error: "Forbidden: customer is outside your scope" },
        { status: 403 }
      );
    }
    if (
      filters.siteId &&
      !scope.isInternal &&
      !scope.siteIds.includes(filters.siteId)
    ) {
      return NextResponse.json(
        { error: "Forbidden: site is outside your scope" },
        { status: 403 }
      );
    }

    const supabase = createAdminClient();

    let query = supabase
      .from("tickets")
      .select(
        scope.isInternal
          ? INTERNAL_TICKET_LIST_SELECT
          : EXTERNAL_TICKET_LIST_SELECT
      )
      .order("created_at", { ascending: false });

    // Tenant scope: internal users see everything; everyone else
    // is limited to the site_ids in their scope (see lib/supabase/scope.ts).
    query = scopeTickets(query, scope);

    if (filters.status) query = query.eq("status", filters.status);

    if (filters.severity) query = query.eq("severity", filters.severity);

    if (filters.customerId) query = query.eq("customer_id", filters.customerId);
    if (filters.siteId) query = query.eq("site_id", filters.siteId);

    query = query.limit(filters.limit);

    const { data: tickets, error } = await query;

    if (error) {
      console.error("Failed to fetch tickets:", {
        code: (error as { code?: string }).code,
      });
      return NextResponse.json(
        { error: "Failed to fetch tickets" },
        { status: 500 }
      );
    }

    // The external query already uses an explicit allow-list. Keep this
    // response shaper as defense in depth against a future projection change.
    const STRIPPED_FIELDS = [
      "secure_token",
      "submitter_email",
      "submitter_phone",
      "internal_summary",
      "root_cause_category",
      "follow_up_needed",
    ];
    const ticketRows = (tickets ?? []) as unknown as Record<string, unknown>[];
    const safeTickets = scope.isInternal
      ? tickets
      : ticketRows.map((t) => {
          const copy: Record<string, unknown> = { ...t };
          for (const f of STRIPPED_FIELDS) delete copy[f];
          return copy;
        });

    return NextResponse.json(
      { tickets: safeTickets },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("Get tickets error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
