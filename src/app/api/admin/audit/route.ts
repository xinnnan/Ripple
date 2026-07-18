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

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get("entity_type");
    const action = searchParams.get("action");
    const actorId = searchParams.get("actor_id");
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1),
      200
    );

    const supabase = createAdminClient();
    let query = supabase
      .from("audit_logs_with_actor")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (entityType) query = query.eq("entity_type", entityType);
    if (action) query = query.eq("action", action);
    if (actorId) query = query.eq("actor_id", actorId);

    const { data: entries, error } = await query;
    if (error) {
      console.error("[api/admin/audit] query failed:", error);
      return NextResponse.json(
        { error: "Failed to fetch audit entries" },
        { status: 500 }
      );
    }

    return NextResponse.json({ entries: entries ?? [] });
  } catch (error) {
    console.error("[api/admin/audit] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
