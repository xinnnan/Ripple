// /api/admin/audit — list audit log entries (admin only).
//
// Backed by the `audit_logs` view that joins actor info. Returns
// { entries: AuditEntry[], total: number } with optional filters.
//
// Apply `supabase/migrations/018_audit_logs.sql` first — without
// it this route returns 500 with 'relation does not exist'.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAdminAuditListFilters } from "@/lib/admin-list-filters";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const parsedFilters = parseAdminAuditListFilters(searchParams);
    if (!parsedFilters.success) {
      return NextResponse.json(
        { error: "Invalid audit filters" },
        { status: 400 }
      );
    }
    const filters = parsedFilters.data;

    const supabase = createAdminClient();
    let query = supabase
      .from("audit_logs_with_actor")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(filters.limit);

    if (filters.entityType) query = query.eq("entity_type", filters.entityType);
    if (filters.action) query = query.eq("action", filters.action);
    if (filters.actorId) query = query.eq("actor_id", filters.actorId);

    const { data: entries, error } = await query;
    if (error) {
      console.error("[api/admin/audit] query failed:", {
        code: (error as { code?: string }).code,
      });
      return NextResponse.json(
        { error: "Failed to fetch audit entries" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { entries: entries ?? [] },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("[api/admin/audit] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
