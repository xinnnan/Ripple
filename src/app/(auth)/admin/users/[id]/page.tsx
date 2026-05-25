import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { UserRole } from "@/types/ticket";
import { EditUserForm } from "./edit-user-form";
import { ADMIN_ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  const { data: userProfile } = await supabase
    .from("users")
    .select("role")
    .eq("id", authUser.id)
    .single();

  const role = userProfile?.role as UserRole | undefined;
  if (!role || !ADMIN_ROLES.includes(role)) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  // Get user details
  const { data: user } = await admin
    .from("users")
    .select("id, email, full_name, role, status, phone, created_at")
    .eq("id", id)
    .single();

  if (!user) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">User not found.</p>
        <Link
          href="/admin/users"
          className="text-sm font-medium text-primary hover:text-primary/80 mt-4 inline-block"
        >
          ← Back to Users
        </Link>
      </div>
    );
  }

  // Get user's site memberships
  const { data: memberships } = await admin
    .from("site_members")
    .select(
      `
      id,
      role,
      site_id,
      sites(id, site_name, site_code)
    `
    )
    .eq("user_id", id);

  // Get all sites for assignment
  const { data: allSites } = await admin
    .from("sites")
    .select("id, site_name, site_code, customer:customers(name)")
    .order("site_name");

  interface MembershipRow {
    id: string;
    role: string;
    site_id: string;
    sites: { id: string; site_name: string; site_code: string }[] | null;
  }

  interface SiteOption {
    id: string;
    site_name: string;
    site_code: string;
    customer: { name: string }[] | null;
  }

  const typedMemberships = (memberships || []) as unknown as MembershipRow[];
  const typedAllSites = (allSites || []) as unknown as SiteOption[];

  return (
    <div className="p-8">
      <div className="mb-8">
        <Link
          href="/admin/users"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Users
        </Link>
        <h1 className="text-2xl font-bold text-foreground mt-2">
          Edit User
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage user details and site access
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* User Edit Form */}
        <EditUserForm user={user} />

        {/* Site Access */}
        <div className="rounded-xl border border-border p-6">
          <h2 className="text-base font-semibold text-foreground mb-4">
            Site Access
          </h2>

          {/* Current memberships */}
          <div className="space-y-2 mb-4">
            {typedMemberships.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sites assigned.
              </p>
            ) : (
              typedMemberships.map((m) => {
                const siteData = Array.isArray(m.sites)
                  ? m.sites[0]
                  : m.sites;
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {siteData?.site_name || "Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {siteData?.site_code}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground capitalize">
                        {m.role}
                      </span>
                      <form action={`/api/admin/site-members?action=remove&membershipId=${m.id}`} method="POST">
                        <button
                          type="submit"
                          className="text-xs font-medium text-red-600 hover:text-red-800 transition-colors"
                        >
                          Remove
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Add site access */}
          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-medium text-foreground mb-3">
              Add Site Access
            </h3>
            <form
              action={`/api/admin/site-members?userId=${id}`}
              method="POST"
              className="flex items-end gap-3"
            >
              <div className="flex-1">
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Site
                </label>
                <select
                  name="site_id"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
                >
                  <option value="">Select a site...</option>
                  {typedAllSites.map((site) => {
                    const customerData = site.customer as unknown as { name: string }[] | null;
                    const customerName = Array.isArray(customerData)
                      ? customerData[0]?.name
                      : undefined;
                    return (
                      <option key={site.id} value={site.id}>
                        {site.site_name} ({site.site_code})
                        {customerName ? ` — ${customerName}` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Role
                </label>
                <select
                  name="role"
                  className="rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button
                type="submit"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Add
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
