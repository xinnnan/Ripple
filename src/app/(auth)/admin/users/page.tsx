import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { UserRole } from "@/types/ticket";
import { CreateUserForm } from "./create-user-form";
import { ADMIN_ROLES } from "@/lib/roles";
import { UsersTable } from "./users-table";
import { assertPageQueriesSucceeded } from "@/lib/server-page-query";

export const metadata: Metadata = { title: "Users" };

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  const profileResult = await supabase
    .from("users")
    .select("role")
    .eq("id", authUser.id)
    .maybeSingle();
  assertPageQueriesSucceeded("admin/user-list-profile", profileResult);
  const userProfile = profileResult.data;

  const role = userProfile?.role as UserRole | undefined;
  if (!role || !ADMIN_ROLES.includes(role)) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  const [usersResult, customersResult, sitesResult] = await Promise.all([
    admin
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
      .limit(100),
    admin
      .from("customers")
      .select("id, name")
      .in("status", ["active", "trial"])
      .order("name"),
    admin
      .from("sites")
      .select("id, site_name, site_code, customer_id")
      .eq("status", "active")
      .order("site_name"),
  ]);
  assertPageQueriesSucceeded(
    "admin/user-list",
    usersResult,
    customersResult,
    sitesResult
  );
  const users = usersResult.data;

  const typedUsers = (users || []) as unknown as React.ComponentProps<typeof UsersTable>["users"];

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">User Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Invite customers to their company portal and manage DropletAI staff
          </p>
        </div>
      </div>

      <CreateUserForm
        customers={customersResult.data ?? []}
        sites={sitesResult.data ?? []}
      />

      <div className="mt-6">
        <UsersTable users={typedUsers} currentUserId={authUser.id} />
      </div>
    </div>
  );
}
