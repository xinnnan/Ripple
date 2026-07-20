import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { logDiff } from "@/lib/audit";
import { z } from "zod";

const updateTeamSchema = z.object({
  full_name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["active", "inactive", "invited"]).optional(),
  site_ids: z.array(z.string().uuid()).max(100).optional(),
});

// PATCH /api/team/[id] — Update a team member (site assignments, status)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const auth = await getAuthUser();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!auth.isManager || !auth.customerId) {
      return NextResponse.json({ error: "Forbidden: Customer Manager access required" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const data = updateTeamSchema.parse(body);

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Verify the target user belongs to the same customer
    const { data: targetUser } = await supabase
      .from("users")
      .select("id, customer_id, role, email, full_name, status")
      .eq("id", id)
      .single();

    if (!targetUser || targetUser.customer_id !== auth.customerId) {
      return NextResponse.json({ error: "User not found in your organization" }, { status: 404 });
    }

    // Cannot modify other customer_managers
    if (targetUser.role === "customer_manager") {
      return NextResponse.json({ error: "Cannot modify other managers" }, { status: 403 });
    }

    // Update basic fields
    const updates: Record<string, string> = {};
    if (data.full_name !== undefined) updates.full_name = data.full_name;
    if (data.status !== undefined) updates.status = data.status;

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from("users")
        .update(updates)
        .eq("id", id);

      if (error) {
        console.error("PATCH /api/team/[id] user update failed:", error);
        return NextResponse.json({ error: "Failed to update team member" }, { status: 500 });
      }
    }

    // Update site assignments
    if (data.site_ids !== undefined) {
      // Verify all sites belong to this customer
      if (data.site_ids.length > 0) {
        const { data: sites } = await supabase
          .from("sites")
          .select("id")
          .eq("customer_id", auth.customerId)
          .in("id", data.site_ids);

        const validSiteIds = (sites || []).map((s: { id: string }) => s.id);
        const invalidSites = data.site_ids.filter((sid: string) => !validSiteIds.includes(sid));
        if (invalidSites.length > 0) {
          return NextResponse.json(
            { error: "Some sites do not belong to your organization" },
            { status: 400 }
          );
        }
      }

      // Remove existing memberships
      await supabase
        .from("site_members")
        .delete()
        .eq("user_id", id);

      // Add new memberships
      if (data.site_ids.length > 0) {
        const memberInserts = data.site_ids.map((siteId: string) => ({
          site_id: siteId,
          user_id: id,
          role: "member",
        }));
        await supabase.from("site_members").insert(memberInserts);
      }
    }

    // Audit
    const auditAfter: Record<string, unknown> = { ...updates };
    if (data.site_ids !== undefined) {
      auditAfter.site_ids = data.site_ids;
    }
    await logDiff({
      actorId: auth.userId,
      actorEmail: auth.email,
      actorRole: auth.role,
      entityType: "user",
      entityId: id,
      before: {
        full_name: targetUser.full_name,
        status: targetUser.status,
      },
      after: auditAfter,
      metadata: { target_email: targetUser.email, customer_id: auth.customerId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Update team member error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
