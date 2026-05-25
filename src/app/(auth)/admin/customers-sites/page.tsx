import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { UserRole, ProjectStatus } from "@/types/ticket";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_COLORS,
} from "@/types/ticket";
import { CreateCustomerForm } from "../customers/create-customer-form";
import { CreateSiteForm } from "../sites/create-site-form";
import { ADMIN_ROLES } from "@/lib/roles";

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

  const customers = customersRes.data || [];
  const allSites = sitesRes.data || [];

  // Build customer options for the CreateSiteForm
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

      {/* Customers with their Sites */}
      <div className="space-y-6">
        {customers.length === 0 ? (
          <div className="rounded-xl border border-border p-12 text-center">
            <p className="text-sm text-muted-foreground">
              No customers yet. Create your first customer above.
            </p>
          </div>
        ) : (
          customers.map((customer: {
            id: string;
            name: string;
            domain: string | null;
            status: string;
            sites: { id: string; site_name: string; site_code: string; project_status: string }[] | null;
          }) => {
            return (
              <div key={customer.id} className="rounded-xl border border-border overflow-hidden">
                {/* Customer Header */}
                <div className="flex items-center justify-between p-4 bg-muted/30 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <span className="text-xs font-bold text-primary">
                        {customer.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        className="text-sm font-semibold text-foreground hover:text-primary transition-colors"
                      >
                        {customer.name}
                      </Link>
                      {customer.domain && (
                        <span className="text-xs text-muted-foreground ml-2">
                          {customer.domain}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        customer.status === "active"
                          ? "bg-green-50 text-green-700"
                          : "bg-gray-50 text-gray-700"
                      }`}
                    >
                      {customer.status}
                    </span>
                    <CreateSiteForm
                      customers={customerOptions}
                      defaultCustomerId={customer.id}
                      defaultCustomerName={customer.name}
                      compact
                    />
                    <Link
                      href={`/admin/customers/${customer.id}`}
                      className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                      Details →
                    </Link>
                  </div>
                </div>

                {/* Sites */}
                <div className="p-4">
                  {customer.sites && customer.sites.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {customer.sites.map((site) => {
                        const statusColor =
                          PROJECT_STATUS_COLORS[site.project_status as ProjectStatus] ||
                          "bg-gray-100 text-gray-800";
                        const statusLabel =
                          PROJECT_STATUS_LABELS[site.project_status as ProjectStatus] ||
                          site.project_status;

                        return (
                          <Link
                            key={site.id}
                            href={`/admin/sites/${site.id}`}
                            className="flex items-center justify-between rounded-lg border border-border px-3 py-2 hover:bg-muted/50 transition-colors"
                          >
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {site.site_name}
                              </p>
                              <p className="text-xs font-mono text-muted-foreground">
                                {site.site_code}
                              </p>
                            </div>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}
                            >
                              {statusLabel}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No sites yet. Use the Add Site button above to add one.
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
