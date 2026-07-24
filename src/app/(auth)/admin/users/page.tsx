import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { UserRole } from "@/types/ticket";
import { CreateUserForm } from "./create-user-form";
import { ADMIN_ROLES } from "@/lib/roles";
import { UsersTable } from "./users-table";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
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

  const typedUsers = (users || []) as unknown as React.ComponentProps<typeof UsersTable>["users"];

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">User Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage user accounts and site access
          </p>
        </div>
      </div>

      <CreateUserForm />

      <div className="mt-6">
        <UsersTable users={typedUsers} />
      </div>
    </div>
  );
}
