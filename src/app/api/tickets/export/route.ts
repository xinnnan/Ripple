import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getUserScope, scopeTickets } from "@/lib/supabase/scope";

export const dynamic = "force-dynamic";

function escapeCsv(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const HEADERS = [
  "Ticket #",
  "Title",
  "Description",
  "Request Type",
  "Severity",
  "Status",
  "Impact",
  "Source",
  "Customer",
  "Site Code",
  "Site Name",
  "Assignee",
  "Created At",
  "Updated At",
  "Resolved At",
  "Closed At",
];

function csvResponse(content: string, dateStamp: string) {
  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ripple-tickets-${dateStamp}.csv"`,
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    // Auth required — no anonymous exports. The scope filter below
    // also keeps each user to their own tickets.
    const auth = await getAuthUser();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const scope = await getUserScope();
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { searchParams } = new URL(request.url);

    let query = admin
      .from("tickets")
      .select(
        `
        ticket_no,
        title,
        description,
        request_type,
        severity,
        status,
        impact,
        source,
        customer:customers(name),
        site:sites(site_code, site_name),
        owner:users!tickets_owner_id_fkey(full_name),
        created_at,
        updated_at,
        resolved_at,
        closed_at
      `
      )
      .order("created_at", { ascending: false });

    // Scope to the user's tenant
    query = scopeTickets(query, scope);

    // Filter parameters — all gated by the user's scope
    const status = searchParams.get("status");
    if (status) query = query.eq("status", status);

    const severity = searchParams.get("severity");
    if (severity) query = query.eq("severity", severity);

    const filterCustomerId = searchParams.get("customer_id");
    if (filterCustomerId) {
      // Only admins can override the customer filter
      if (!scope.isInternal) {
        return NextResponse.json(
          { error: "Forbidden: customer filter is admin-only" },
          { status: 403 }
        );
      }
      query = query.eq("customer_id", filterCustomerId);
    }

    const siteId = searchParams.get("site_id");
    if (siteId) {
      // Non-internal users can only filter within their visible sites
      if (!scope.isInternal && !scope.siteIds.includes(siteId)) {
        return NextResponse.json(
          { error: "Forbidden: site is outside your scope" },
          { status: 403 }
        );
      }
      query = query.eq("site_id", siteId);
    }

    const dateFrom = searchParams.get("date_from");
    if (dateFrom) query = query.gte("created_at", dateFrom);

    const dateTo = searchParams.get("date_to");
    if (dateTo) query = query.lte("created_at", dateTo);

    const { data: tickets, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (tickets || []).map((t: Record<string, unknown>) => [
      escapeCsv(t.ticket_no),
      escapeCsv(t.title),
      escapeCsv(t.description),
      escapeCsv(t.request_type),
      escapeCsv(t.severity),
      escapeCsv(t.status),
      escapeCsv(t.impact),
      escapeCsv(t.source),
      escapeCsv((t.customer as Record<string, unknown>)?.name ?? ""),
      escapeCsv((t.site as Record<string, unknown>)?.site_code ?? ""),
      escapeCsv((t.site as Record<string, unknown>)?.site_name ?? ""),
      escapeCsv((t.owner as Record<string, unknown>)?.full_name ?? ""),
      escapeCsv(t.created_at),
      escapeCsv(t.updated_at),
      escapeCsv(t.resolved_at),
      escapeCsv(t.closed_at),
    ]);

    const csv = [HEADERS.map(escapeCsv).join(","), ...rows.map((r) => r.join(","))].join("\n");
    return csvResponse(csv, new Date().toISOString().slice(0, 10));
  } catch (err) {
    console.error("CSV export error:", err);
    return NextResponse.json(
      { error: "Failed to export tickets" },
      { status: 500 }
    );
  }
}
