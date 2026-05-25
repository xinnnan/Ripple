import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";

// PATCH /api/team/[id] — Update a team member (site assignments, status)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuthUser();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!auth.isManager || !auth.customerId) {
    return NextResponse.json({ error: "Forbidden: Customer Manager access required" }, { status: 403 });
  }

  const body = await request.json();
  const { full_name, status, site_ids } = body;

  const supabase = createAdminClient();

  // Verify the target user belongs to the same customer
  const { data: targetUser } = await supabase
    .from("users")
    .select("id, customer_id, role")
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
  if (full_name !== undefined) updates.full_name = full_name;
  if (status !== undefined) updates.status = status;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Update site assignments
  if (site_ids !== undefined) {
    // Verify all sites belong to this customer
    if (site_ids.length > 0) {
      const { data: sites } = await supabase
        .from("sites")
        .select("id")
        .eq("customer_id", auth.customerId)
        .in("id", site_ids);

      const validSiteIds = (sites || []).map((s: { id: string }) => s.id);
      const invalidSites = site_ids.filter((sid: string) => !validSiteIds.includes(sid));
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
    if (site_ids.length > 0) {
      const memberInserts = site_ids.map((siteId: string) => ({
        site_id: siteId,
        user_id: id,
        role: "member",
      }));
      await supabase.from("site_members").insert(memberInserts);
    }
  }

  return NextResponse.json({ success: true });
}
