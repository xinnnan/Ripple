import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { UserRole } from "@/types/ticket";
import { CreateCustomerForm } from "./create-customer-form";
import { ADMIN_ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AdminCustomersPage() {
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

  const { data: customers } = await admin
    .from("customers")
    .select(
      `
      id, name, domain, status, created_at,
      sites(id, site_name, site_code, status, project_status)
    `
    )
    .order("name")
    .limit(100);

  interface CustomerRow {
    id: string;
    name: string;
    domain: string | null;
    status: string;
    created_at: string;
    sites: { id: string; site_name: string; site_code: string; status: string; project_status: string }[] | null;
  }

  const typedCustomers = (customers || []) as unknown as CustomerRow[];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Customers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage customer organizations, their sites and contacts
        </p>
      </div>

      {/* Create Customer Form */}
      <CreateCustomerForm />

      {/* Customers List */}
      <div className="space-y-4">
        {typedCustomers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center">
            <div className="mx-auto h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
              <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">
              No customers yet
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Use the form above to create your first customer. Each customer
              can have multiple sites and users.
            </p>
          </div>
        ) : (
          typedCustomers.map((customer) => (
            <div
              key={customer.id}
              className="rounded-xl border border-border p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <span className="text-sm font-bold text-primary">
                      {customer.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <Link
                      href={`/admin/customers/${customer.id}`}
                      className="text-base font-semibold text-foreground hover:text-primary transition-colors"
                    >
                      {customer.name}
                    </Link>
                    {customer.domain && (
                      <p className="text-xs text-muted-foreground">
                        {customer.domain}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      customer.status === "active"
                        ? "bg-green-50 text-green-700"
                        : "bg-gray-50 text-gray-700"
                    }`}
                  >
                    {customer.status}
                  </span>
                  <Link
                    href={`/admin/customers/${customer.id}`}
                    className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    View Details →
                  </Link>
                </div>
              </div>

              {/* Sites */}
              {customer.sites && customer.sites.length > 0 && (
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Sites ({customer.sites.length})
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {customer.sites.map((site) => (
                      <Link
                        key={site.id}
                        href={`/admin/sites/${site.id}`}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2 hover:bg-muted/50 transition-colors"
                      >
                        <div>
                          <p className="text-sm text-foreground">{site.site_name}</p>
                          <p className="text-xs font-mono text-muted-foreground">{site.site_code}</p>
                        </div>
                        <span className="text-xs text-muted-foreground capitalize">
                          {site.project_status?.replace(/_/g, " ") || "N/A"}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
