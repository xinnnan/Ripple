import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { UserRole } from "@/types/ticket";
import { CreateCustomerForm } from "../customers/create-customer-form";
import { ADMIN_ROLES } from "@/lib/roles";
import { CustomersSitesCards } from "./customers-sites-cards";
import { assertPageQueriesSucceeded } from "@/lib/server-page-query";

export const dynamic = "force-dynamic";

export default async function CustomersSitesPage() {
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
  assertPageQueriesSucceeded(
    "admin/customer-site-list-profile",
    profileResult
  );
  const userProfile = profileResult.data;

  const role = userProfile?.role as UserRole | undefined;
  if (!role || !ADMIN_ROLES.includes(role)) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  const customersResult = await admin
    .from("customers")
    .select(
      "id, name, domain, status, sites(id, site_name, site_code, project_status, status)"
    )
    .order("name");
  assertPageQueriesSucceeded("admin/customer-site-list", customersResult);

  const customers = customersResult.data || [];

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Customers & Sites</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage customer organizations and their sites
          </p>
        </div>
        <CreateCustomerForm />
      </div>

      <CustomersSitesCards customers={customers as any} />
    </div>
  );
}
