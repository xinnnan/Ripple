import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getUserScope, scopeTickets } from "@/lib/supabase/scope";
import { buildTicketCsv } from "@/lib/tickets/csv-export";
import { parseTicketExportFilters } from "@/lib/tickets/export-filters";
import { buildTicketSearchFilter } from "@/lib/tickets/search-filter";

export const dynamic = "force-dynamic";

function csvResponse(content: string, dateStamp: string) {
  return new NextResponse(`\uFEFF${content}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ripple-tickets-${dateStamp}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
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

    const { searchParams } = new URL(request.url);
    const parsedFilters = parseTicketExportFilters(searchParams);
    if (!parsedFilters.success) {
      return NextResponse.json(
        { error: "Invalid export filters" },
        { status: 400 }
      );
    }
    const filters = parsedFilters.data;
    const admin = createAdminClient();

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
    if (filters.status.length > 0) {
      query = query.in("status", filters.status);
    }

    if (filters.severity.length > 0) {
      query = query.in("severity", filters.severity);
    }

    if (filters.customerId) {
      if (!scope.isInternal && scope.customerId !== filters.customerId) {
        return NextResponse.json(
          { error: "Forbidden: customer is outside your scope" },
          { status: 403 }
        );
      }
      query = query.eq("customer_id", filters.customerId);
    }

    if (filters.siteId) {
      // Non-internal users can only filter within their visible sites
      if (!scope.isInternal && !scope.siteIds.includes(filters.siteId)) {
        return NextResponse.json(
          { error: "Forbidden: site is outside your scope" },
          { status: 403 }
        );
      }
      query = query.eq("site_id", filters.siteId);
    }

    if (filters.ownerId) {
      if (!scope.isInternal) {
        return NextResponse.json(
          { error: "Forbidden: owner filter is internal-only" },
          { status: 403 }
        );
      }
      query = query.eq("owner_id", filters.ownerId);
    }

    if (filters.q) {
      query = query.or(buildTicketSearchFilter(filters.q));
    }

    if (filters.range && filters.range !== "all") {
      const days = filters.range === "7d" ? 7 : filters.range === "30d" ? 30 : 90;
      query = query.gte(
        "created_at",
        new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      );
    }
    if (filters.dateFrom) {
      query = query.gte("created_at", filters.dateFrom);
    }
    if (filters.dateTo) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo)) {
        const exclusiveEnd = new Date(`${filters.dateTo}T00:00:00.000Z`);
        exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
        query = query.lt("created_at", exclusiveEnd.toISOString());
      } else {
        query = query.lte("created_at", filters.dateTo);
      }
    }

    if (filters.sla && filters.sla !== "all") {
      if (!scope.isInternal) {
        return NextResponse.json(
          { error: "Forbidden: SLA filter is internal-only" },
          { status: 403 }
        );
      }
      const now = new Date().toISOString();
      if (filters.sla === "breached") {
        query = query.eq("sla_breached", true);
      } else if (filters.sla === "breaching") {
        query = query
          .eq("sla_breached", false)
          .lt("resolve_due_at", now)
          .not("status", "in", "(resolved,closed)");
      } else if (filters.sla === "on_track") {
        query = query
          .not("sla_policy_id", "is", null)
          .eq("sla_breached", false)
          .or(`resolve_due_at.gte.${now},resolve_due_at.is.null`);
      } else if (filters.sla === "no_sla") {
        query = query.is("sla_policy_id", null);
      }
    }

    const { data: tickets, error } = await query;

    if (error) {
      console.error("CSV export query failed:", {
        code: (error as { code?: string }).code,
      });
      return NextResponse.json(
        { error: "Failed to export tickets" },
        { status: 500 }
      );
    }

    const csv = buildTicketCsv(
      (tickets || []) as unknown as Record<string, unknown>[]
    );
    return csvResponse(csv, new Date().toISOString().slice(0, 10));
  } catch (err) {
    console.error("CSV export error:", err);
    return NextResponse.json(
      { error: "Failed to export tickets" },
      { status: 500 }
    );
  }
}
