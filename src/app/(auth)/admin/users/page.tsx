import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { UserRole } from "@/types/ticket";
import { CreateUserForm } from "./create-user-form";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<UserRole, string> = {
  internal_admin: "Internal Admin",
  internal_service_manager: "Service Manager",
  internal_engineer: "Engineer",
  internal_solution_engineer: "Solution Engineer",
  customer_admin: "Customer Admin",
  customer_user: "Customer User",
  guest: "Guest",
};

const ADMIN_ROLES: UserRole[] = ["internal_admin"];

export default async function AdminUsersPage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  // Check if user is internal admin
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

  const { data: users } = await admin
    .from("users")
    .select(
      `
      id,
      email,
      full_name,
      role,
      status,
      created_at,
      site_members(site_id, sites(site_name, site_code))
    `
    )
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            User Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage user accounts and site access
          </p>
        </div>
      </div>

      <CreateUserForm />

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                User
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
                Created
              </th>
              <th className="p-3 text-right text-xs font-medium text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users?.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="p-6 text-center text-sm text-muted-foreground"
                >
                  No users found.
                </td>
              </tr>
            ) : (
              users?.map(
                (u: {
                  id: string;
                  email: string;
                  full_name: string | null;
                  role: string;
                  status: string;
                  created_at: string;
                  site_members: {
                    site_id: string;
                    sites: { site_name: string; site_code: string }[] | null;
                  }[];
                }) => (
                  <tr key={u.id} className="hover:bg-muted/30">
                    <td className="p-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {u.full_name || "Unnamed"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {u.email}
                        </p>
                      </div>
                    </td>
                    <td className="p-3">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                        {ROLE_LABELS[u.role as UserRole] || u.role}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="space-y-0.5">
                        {u.site_members && u.site_members.length > 0 ? (
                          u.site_members.map((sm, i) => {
                            const siteData = Array.isArray(sm.sites)
                              ? sm.sites[0]
                              : sm.sites;
                            return (
                              <p
                                key={i}
                                className="text-xs text-muted-foreground"
                              >
                                {siteData?.site_name || "Unknown"}{" "}
                                <span className="font-mono">
                                  ({siteData?.site_code})
                                </span>
                              </p>
                            );
                          })
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No sites
                          </p>
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
                    <td className="p-3">
                      <span className="text-xs text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
