import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { UserRole } from "@/types/ticket";
import { CreateCustomerForm } from "../customers/create-customer-form";
import { ADMIN_ROLES } from "@/lib/roles";
import { CustomersSitesCards } from "./customers-sites-cards";

export const dynamic = "force-dynamic";

export default async function CustomersSitesPage() {
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

  const [customersRes, sitesRes] = await Promise.all([
    admin
      .from("customers")
      .select("id, name, domain, status, sites(id, site_name, site_code, project_status)")
      .order("name"),
    admin
      .from("sites")
      .select("id, site_name, site_code, project_status, slack_channel_id, customer:customers(id, name), site_members(user_id)")
      .order("site_name"),
  ]);

  // Use the customer-embedded sites for the bulk-delete UI (the
  // card layout) so the site checkboxes are nested under their
  // customer. The flat `sitesRes` is still useful for the create-site
  // form's options, but the bulk-delete UI only needs the
  // customer-grouped data.
  const customers = customersRes.data || [];
  const customerOptions = customers.map((c: { id: string; name: string }) => ({
    id: c.id,
    name: c.name,
  }));

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

      {/* `sitesRes` retained for any future flat-site list; today the
          card view already covers everything. */}
      {/* @ts-ignore unused */}
      <div className="hidden">{JSON.stringify(sitesRes.data?.length || 0)}</div>
    </div>
  );
}
