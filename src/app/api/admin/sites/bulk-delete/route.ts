import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  force: z.boolean().optional(),
});

// POST /api/admin/sites/bulk-delete — delete multiple sites
//
// Cascades to tickets (FK CASCADE). Site_members for the deleted
// sites are also removed (FK CASCADE on migration 016).
//
// Same open-tickets guard as customers/bulk-delete — pass force=true
// to skip.
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

    const failed: { id: string; reason: string }[] = [];
    const toDelete: string[] = [];

    if (!force) {
      const { data: openCounts } = await supabase
        .from("tickets")
        .select("site_id")
        .in("site_id", ids)
        .not("status", "in", "(resolved,closed)");
      const siteIdsWithOpenTickets = new Set(
        (openCounts || []).map((r) => r.site_id as string)
      );
      for (const id of ids) {
        if (siteIdsWithOpenTickets.has(id)) {
          failed.push({ id, reason: "Site has open tickets; resolve or close them first, or pass force=true" });
        } else {
          toDelete.push(id);
        }
      }
    } else {
      toDelete.push(...ids);
    }

    let deletedCount = 0;
    for (const id of toDelete) {
      const { data: deletedRows, error } = await supabase
        .from("sites")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) {
        failed.push({ id, reason: error.message });
        continue;
      }
      if (!deletedRows || deletedRows.length === 0) {
        failed.push({ id, reason: "Site not found" });
        continue;
      }
      await logAudit({
        actorId: auth.userId,
        actorEmail: auth.email,
        actorRole: auth.role,
        entityType: "site",
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
    console.error("Bulk delete sites error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
