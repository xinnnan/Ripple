import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function escapeCsv(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);

    // Build query with filters
    let query = supabase
      .from("tickets")
      .select(`
        ticket_no,
        title,
        description,
        request_type,
        severity,
        status,
        impact,
        source,
        customer:customers(name),
        site:sites(site_code, name),
        assignee:users(full_name),
        created_at,
        updated_at,
        resolved_at,
        closed_at
      `)
      .order("created_at", { ascending: false });

    // Apply same filters as ticket list
    const status = searchParams.get("status");
    if (status) query = query.eq("status", status);

    const severity = searchParams.get("severity");
    if (severity) query = query.eq("severity", severity);

    const customerId = searchParams.get("customer_id");
    if (customerId) query = query.eq("customer_id", customerId);

    const siteId = searchParams.get("site_id");
    if (siteId) query = query.eq("site_id", siteId);

    const dateFrom = searchParams.get("date_from");
    if (dateFrom) query = query.gte("created_at", dateFrom);

    const dateTo = searchParams.get("date_to");
    if (dateTo) query = query.lte("created_at", dateTo);

    const { data: tickets, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Build CSV
    const headers = [
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
      escapeCsv((t.site as Record<string, unknown>)?.name ?? ""),
      escapeCsv((t.assignee as Record<string, unknown>)?.full_name ?? ""),
      escapeCsv(t.created_at),
      escapeCsv(t.updated_at),
      escapeCsv(t.resolved_at),
      escapeCsv(t.closed_at),
    ]);

    const csvContent = [
      headers.map(escapeCsv).join(","),
      ...rows.map((row) => row.join(",")),
    ].join("\n");

    const filename = `ripple-tickets-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("CSV export error:", err);
    return NextResponse.json(
      { error: "Failed to export tickets" },
      { status: 500 }
    );
  }
}
