import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
import Link from "next/link";

export default async function CustomersPage() {
  const supabase = createAdminClient();

  const { data: customers } = await supabase
    .from("customers")
    .select(
      `
      id, name, domain, status, created_at,
      sites(id, site_name, site_code, status)
    `
    )
    .order("name")
    .limit(100);

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Customers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage customers and their sites
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {customers?.length === 0 ? (
          <div className="col-span-full text-center py-12 text-sm text-muted-foreground">
            No customers yet. Add customers through the database or API.
          </div>
        ) : (
          customers?.map(
            (customer: {
              id: string;
              name: string;
              domain: string | null;
              status: string;
              sites: { id: string; site_name: string; site_code: string; status: string }[];
            }) => (
              <div
                key={customer.id}
                className="rounded-xl border border-border p-6"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-foreground">
                    {customer.name}
                  </h3>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      customer.status === "active"
                        ? "bg-green-50 text-green-700"
                        : "bg-gray-50 text-gray-700"
                    }`}
                  >
                    {customer.status}
                  </span>
                </div>
                {customer.domain && (
                  <p className="text-xs text-muted-foreground mb-3">
                    {customer.domain}
                  </p>
                )}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Sites ({customer.sites?.length || 0})
                  </p>
                  {customer.sites?.map((site) => (
                    <div
                      key={site.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-foreground">{site.site_name}</span>
                      <span className="text-xs font-mono text-muted-foreground">
                        {site.site_code}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}
