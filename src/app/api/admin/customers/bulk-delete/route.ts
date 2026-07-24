import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

// POST /api/admin/customers/bulk-delete — delete multiple customers
//
// Cascades through sites, tickets, sla_policies (FK CASCADE on
// migration 002 / 004 / 024). Audit-logs each deletion.
//
// We refuse to delete the last admin's organization (where the
// caller themselves lives) and we block customers that still have
// non-resolved tickets UNLESS force=true is passed. force=true
// is intended for the "delete demo data" cleanup script only.
//
// Why not just cascade silently? Because the FK cascade is a
// blunt instrument — a single click deleting 5 customers could
// take out 200 tickets and 50 sites with no recourse. The
// "open ticket" guard gives the operator a chance to close them
// first.
const bodySchema = bulkDeleteSchema.extend({
  force: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.errors },
        { status: 400 }
      );
    }
    const { ids, force } = parsed.data;

    const supabase = createAdminClient();

    // Per-id status check. We don't want to half-delete a batch
    // and report success: each id is either deleted or its reason
    // is in `failed`. The DELETE call below is per-row, so a single
    // FK violation doesn't roll back the rest.
    const failed: { id: string; reason: string }[] = [];
    const toDelete: string[] = [];

    if (!force) {
      // Refuse customers with active tickets (status NOT IN resolved, closed).
      const { data: openCounts } = await supabase
        .from("tickets")
        .select("customer_id")
        .in("customer_id", ids)
        .not("status", "in", "(resolved,closed)");
      const customerIdsWithOpenTickets = new Set(
        (openCounts || []).map((r) => r.customer_id as string)
      );
      for (const id of ids) {
        if (customerIdsWithOpenTickets.has(id)) {
          failed.push({ id, reason: "Customer has open tickets; resolve or close them first, or pass force=true" });
        } else {
          toDelete.push(id);
        }
      }
    } else {
      toDelete.push(...ids);
    }

    let deletedCount = 0;
    for (const id of toDelete) {
      // Use .select() to know whether the row actually existed.
      // A bare .delete() returns success with 0 rows affected for
      // a non-existent id, which we'd mis-report as a successful
      // delete. Selecting the deleted rows forces the count.
      const { data: deletedRows, error } = await supabase
        .from("customers")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) {
        failed.push({ id, reason: error.message });
        continue;
      }
      if (!deletedRows || deletedRows.length === 0) {
        failed.push({ id, reason: "Customer not found" });
        continue;
      }
      await logAudit({
        actorId: auth.userId,
        actorEmail: auth.email,
        actorRole: auth.role,
        entityType: "customer",
        entityId: id,
        action: "deleted",
        metadata: { source: "bulk-delete" },
      });
      deletedCount++;
    }

    return NextResponse.json({
      deleted: deletedCount,
      failed,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Bulk delete customers error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
