import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { UserRole } from "@/types/ticket";
import { isCustomerManager, ROLE_LABELS } from "@/lib/roles";
import { formatDate } from "@/lib/utils";
import { CreateTeamMemberForm } from "./create-team-member-form";
import { TableEmpty } from "@/components/empty-state";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

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

  const admin = createAdminClient();
  const { data: users } = await admin
    .from("users")
    .select("id, email, full_name, role, status, phone, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });

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

  const { data: sites } = await admin
    .from("sites")
    .select("id, site_name, site_code")
    .eq("customer_id", customerId)
    .eq("status", "active")
    .order("site_name");

  const total = users?.length || 0;
  const active = users?.filter((u: { status: string }) => u.status === "active").length || 0;
  const managers = users?.filter((u: { role: string }) => u.role === "customer_manager").length || 0;
  const customers = users?.filter((u: { role: string }) => u.role === "customer").length || 0;

  return (
    <div className="p-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Team</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your organization&apos;s team members and site access.
          </p>
        </div>
      </div>

      {/* Team overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-border p-6">
          <p className="text-xs text-muted-foreground">Total members</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">{total}</p>
        </div>
        <div className="rounded-xl border border-border p-6">
          <p className="text-xs text-muted-foreground">Active</p>
          <p className="text-3xl font-bold text-green-600 mt-1">{active}</p>
        </div>
        <div className="rounded-xl border border-border p-6">
          <p className="text-xs text-muted-foreground">Customer managers</p>
          <p className="text-3xl font-bold text-purple-600 mt-1">{managers}</p>
        </div>
        <div className="rounded-xl border border-border p-6">
          <p className="text-xs text-muted-foreground">Customers</p>
          <p className="text-3xl font-bold text-amber-600 mt-1">{customers}</p>
        </div>
      </div>

      <CreateTeamMemberForm sites={sites || []} />

      {/* Team Members Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        {total === 0 ? (
          <TableEmpty
            colSpan={1}
            icon="users"
            title="No team members yet"
            description="Add the first person to your organization. They'll be able to submit and track tickets for the sites you assign them to."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                  Name
                </th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                  Email
                </th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                  Role
                </th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                  Sites
                </th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                  Status
                </th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                  Joined
                </th>
                <th className="p-3 text-right text-xs font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users?.map(
                (u: {
                  id: string;
                  email: string;
                  full_name: string;
                  role: string;
                  status: string;
                  phone: string | null;
                  created_at: string;
                }) => {
                  const userSites = membershipMap.get(u.id) || [];
                  return (
                    <tr key={u.id} className="hover:bg-muted/30">
                      <td className="p-3">
                        <p className="text-sm font-medium text-foreground">
                          {u.full_name}
                        </p>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {u.email}
                      </td>
                      <td className="p-3">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                          {ROLE_LABELS[u.role as UserRole] || u.role}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {userSites.length === 0 ? (
                            <span className="text-xs text-muted-foreground">
                              No sites
                            </span>
                          ) : (
                            <>
                              {userSites.slice(0, 2).map((s) => (
                                <span
                                  key={s.id}
                                  className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground"
                                >
                                  {s.site_name}
                                </span>
                              ))}
                              {userSites.length > 2 && (
                                <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                                  +{userSites.length - 2}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.status === "active"
                              ? "bg-green-50 text-green-700"
                              : "bg-gray-50 text-gray-700"
                          }`}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {formatDate(u.created_at)}
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
                }
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
