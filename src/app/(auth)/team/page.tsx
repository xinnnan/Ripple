import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { UserRole } from "@/types/ticket";
import { isCustomerManager, ROLE_LABELS } from "@/lib/roles";
import { CreateTeamMemberForm } from "./create-team-member-form";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  // Verify customer_manager role
  const { data: userProfile } = await supabase
    .from("users")
    .select("role, email, customer_id")
    .eq("id", authUser.id)
    .single();

  const role = userProfile?.role as UserRole | undefined;
  const customerId = userProfile?.customer_id as string | null;

  if (!role || !isCustomerManager(role) || !customerId) {
    redirect("/dashboard");
  }

  // Get all team members
  const admin = createAdminClient();
  const { data: users } = await admin
    .from("users")
    .select("id, email, full_name, role, status, phone, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });

  // Get site memberships
  const userIds = (users || []).map((u: { id: string }) => u.id);
  const { data: memberships } = await admin
    .from("site_members")
    .select("user_id, site_id, sites(id, site_name, site_code)")
    .in("user_id", userIds);

  interface SiteInfo { id: string; site_name: string; site_code: string }
  const membershipMap = new Map<string, SiteInfo[]>();
  (memberships || []).forEach((m: { user_id: string; sites: unknown }) => {
    const site = (Array.isArray(m.sites) ? m.sites[0] : m.sites) as SiteInfo | null;
    if (!site) return;
    const existing = membershipMap.get(m.user_id) || [];
    existing.push({ id: site.id, site_name: site.site_name, site_code: site.site_code });
    membershipMap.set(m.user_id, existing);
  });

  // Get available sites for the customer
  const { data: sites } = await admin
    .from("sites")
    .select("id, site_name, site_code")
    .eq("customer_id", customerId)
    .eq("status", "active")
    .order("site_name");

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Team</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your organization’s team members and site access.
        </p>
      </div>

      <CreateTeamMemberForm sites={sites || []} />

      {/* Team Members Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase">Name</th>
              <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase">Email</th>
              <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase">Role</th>
              <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase">Sites</th>
              <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
              <th className="p-3 text-right text-xs font-medium text-muted-foreground uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(!users || users.length === 0) ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                  No team members yet.
                </td>
              </tr>
            ) : (
              users.map((u: { id: string; email: string; full_name: string; role: string; status: string; phone: string | null; created_at: string }) => {
                const userSites = membershipMap.get(u.id) || [];
                return (
                  <tr key={u.id} className="hover:bg-muted/30">
                    <td className="p-3">
                      <p className="text-sm font-medium text-foreground">{u.full_name}</p>
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">{u.email}</td>
                    <td className="p-3">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                        {ROLE_LABELS[u.role as UserRole] || u.role}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {userSites.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No sites</span>
                        ) : (
                          userSites.map((s) => (
                            <span
                              key={s.id}
                              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground"
                            >
                              {s.site_name}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.status === "active"
                          ? "bg-green-50 text-green-700"
                          : "bg-gray-50 text-gray-700"
                      }`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <Link
                        href={`/team/${u.id}`}
                        className="text-sm font-medium text-primary hover:text-primary/80"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
