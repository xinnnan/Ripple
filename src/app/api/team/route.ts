import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { z } from "zod";

export const dynamic = "force-dynamic";

// GET /api/team — List team members under the customer_manager's customer
export async function GET() {
  const auth = await getAuthUser();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!auth.isManager || !auth.customerId) {
    return NextResponse.json({ error: "Forbidden: Customer Manager access required" }, { status: 403 });
  }

  const supabase = createAdminClient();

  // Get all users under the same customer
  const { data: users, error } = await supabase
    .from("users")
    .select("id, email, full_name, role, status, phone, created_at")
    .eq("customer_id", auth.customerId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also get site memberships for each user
  const userIds = (users || []).map((u: { id: string }) => u.id);
  const { data: memberships } = await supabase
    .from("site_members")
    .select("user_id, site_id, sites(id, site_name, site_code)")
    .in("user_id", userIds);

  // Attach memberships to users
  const membershipMap = new Map<string, { site_id: string; site_name: string; site_code: string }[]>();
  (memberships || []).forEach((m: { user_id: string; sites: unknown }) => {
    const site = (Array.isArray(m.sites) ? m.sites[0] : m.sites) as { id: string; site_name: string; site_code: string } | null;
    if (!site) return;
    const existing = membershipMap.get(m.user_id) || [];
    existing.push({ site_id: site.id, site_name: site.site_name, site_code: site.site_code });
    membershipMap.set(m.user_id, existing);
  });

  const enrichedUsers = (users || []).map((u: { id: string; email: string; full_name: string; role: string; status: string; phone: string; created_at: string }) => ({
    ...u,
    sites: membershipMap.get(u.id) || [],
  }));

  return NextResponse.json({ data: enrichedUsers });
}

const createTeamMemberSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().min(1).max(200),
  phone: z.string().optional(),
  site_ids: z.array(z.string().uuid()).optional(),
});

// POST /api/team — Create a new customer user under the manager's customer
export async function POST(request: NextRequest) {
  const auth = await getAuthUser();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!auth.isManager || !auth.customerId) {
    return NextResponse.json({ error: "Forbidden: Customer Manager access required" }, { status: 403 });
  }

  const body = await request.json();
  const data = createTeamMemberSchema.parse(body);

  const supabase = createAdminClient();

  // Verify all site_ids belong to this customer
  if (data.site_ids && data.site_ids.length > 0) {
    const { data: sites } = await supabase
      .from("sites")
      .select("id")
      .eq("customer_id", auth.customerId)
      .in("id", data.site_ids);

    const validSiteIds = (sites || []).map((s: { id: string }) => s.id);
    const invalidSites = data.site_ids.filter((id) => !validSiteIds.includes(id));
    if (invalidSites.length > 0) {
      return NextResponse.json(
        { error: "Some sites do not belong to your organization" },
        { status: 400 }
      );
    }
  }

  // Create auth user
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: {
      full_name: data.full_name,
      role: "customer",
    },
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  // Update the auto-created user row with customer_id and phone
  const updateData: Record<string, string> = { customer_id: auth.customerId };
  if (data.phone) updateData.phone = data.phone;
  await supabase
    .from("users")
    .update(updateData)
    .eq("id", authUser.user.id);

  // Assign sites
  if (data.site_ids && data.site_ids.length > 0) {
    const memberInserts = data.site_ids.map((siteId) => ({
      site_id: siteId,
      user_id: authUser.user.id,
      role: "member",
    }));
    await supabase.from("site_members").upsert(memberInserts, { onConflict: "site_id,user_id" });
  }

  return NextResponse.json(
    {
      user: {
        id: authUser.user.id,
        email: data.email,
        full_name: data.full_name,
        role: "customer",
      },
    },
    { status: 201 }
  );
}
