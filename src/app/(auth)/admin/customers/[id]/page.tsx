import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { UserRole } from "@/types/ticket";
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_COLORS } from "@/types/ticket";
import { EditCustomerForm } from "./edit-customer-form";
import { CreateSiteForm } from "../../sites/create-site-form";

export const dynamic = "force-dynamic";

const ADMIN_ROLES: UserRole[] = ["internal_admin"];

export default async function AdminCustomerDetailPage({
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

  // Get customer details
  const { data: customer } = await admin
    .from("customers")
    .select("id, name, domain, status, created_at")
    .eq("id", id)
    .single();

  if (!customer) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Customer not found.</p>
        <Link
          href="/admin/customers"
          className="text-sm font-medium text-primary hover:text-primary/80 mt-4 inline-block"
        >
          ← Back to Customers
        </Link>
      </div>
    );
  }

  // Get customer sites
  const { data: sites } = await admin
    .from("sites")
    .select("id, site_name, site_code, status, project_status, timezone, slack_channel_id")
    .eq("customer_id", id)
    .order("site_name");

  // Get contacts (users who are members of this customer's sites)
  const siteIds = (sites || []).map((s) => s.id);
  let contacts: {
    user_id: string;
    email: string;
    full_name: string;
    role: string;
    site_role: string;
    site_id: string;
    site_name: string;
  }[] = [];

  if (siteIds.length > 0) {
    const { data: memberships } = await admin
      .from("site_members")
      .select(
        `
        role,
        site_id,
        user_id,
        users(id, email, full_name, role),
        sites!inner(site_name)
      `
      )
      .in("site_id", siteIds);

    if (memberships) {
      const seen = new Set<string>();
      contacts = memberships
        .map((m) => {
          const userData = Array.isArray(m.users) ? m.users[0] : m.users;
          const siteData = Array.isArray(m.sites) ? m.sites[0] : m.sites;
          return {
            user_id: m.user_id,
            email: userData?.email || "",
            full_name: userData?.full_name || "Unnamed",
            role: userData?.role || "",
            site_role: m.role,
            site_id: m.site_id,
            site_name: (siteData as unknown as { site_name: string })?.site_name || "",
          };
        })
        .filter((c) => {
          if (seen.has(c.user_id)) return false;
          seen.add(c.user_id);
          return true;
        });
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <Link
          href="/admin/customers"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Customers
        </Link>
        <h1 className="text-2xl font-bold text-foreground mt-2">
          {customer.name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage customer details, sites, and contacts
        </p>
      </div>

      <div className="max-w-4xl space-y-6">
        {/* Customer Edit Form */}
        <EditCustomerForm customer={customer} />

        {/* Sites */}
        <div className="rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">
              Sites ({sites?.length || 0})
            </h2>
            <CreateSiteForm
              customers={[{ id: customer.id, name: customer.name }]}
              defaultCustomerId={customer.id}
              defaultCustomerName={customer.name}
              compact
            />
          </div>

          {(!sites || sites.length === 0) ? (
            <p className="text-sm text-muted-foreground">
              No sites yet. Use the Add Site button above to create one.
            </p>
          ) : (
            <div className="space-y-2">
              {sites.map((site) => {
                const statusColor =
                  PROJECT_STATUS_COLORS[
                    site.project_status as keyof typeof PROJECT_STATUS_COLORS
                  ] || "bg-gray-100 text-gray-800";
                const statusLabel =
                  PROJECT_STATUS_LABELS[
                    site.project_status as keyof typeof PROJECT_STATUS_LABELS
                  ] || site.project_status;

                return (
                  <Link
                    key={site.id}
                    href={`/admin/sites/${site.id}`}
                    className="flex items-center justify-between rounded-lg border border-border px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {site.site_name}
                      </p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {site.site_code}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}
                      >
                        {statusLabel}
                      </span>
                      {site.slack_channel_id && (
                        <span className="text-xs text-green-600">Slack ✓</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Contacts */}
        <div className="rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">
              Contacts ({contacts.length})
            </h2>
            <Link
              href="/admin/users"
              className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Manage Users →
            </Link>
          </div>

          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No contacts yet.{" "}
              <Link
                href="/admin/users"
                className="text-primary hover:text-primary/80"
              >
                Add users
              </Link>{" "}
              and assign them to this customer sites.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
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
                      Site Access
                    </th>
                    <th className="p-3 text-right text-xs font-medium text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {contacts.map((contact) => (
                    <tr key={contact.user_id} className="hover:bg-muted/30">
                      <td className="p-3">
                        <span className="text-sm font-medium text-foreground">
                          {contact.full_name}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="text-sm text-muted-foreground">
                          {contact.email}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 capitalize">
                          {contact.role.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-muted-foreground capitalize">
                          {contact.site_role}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <Link
                          href={`/admin/users/${contact.user_id}`}
                          className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
