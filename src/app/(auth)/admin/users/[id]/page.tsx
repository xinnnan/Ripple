import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/roles";
import { EditUserForm } from "./edit-user-form";
import { DetailTabs, getCurrentTab } from "@/components/detail-tabs";
import { TableEmpty } from "@/components/empty-state";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function AdminUserDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab = getCurrentTab({ tab }, "overview");

  const admin = createAdminClient();

  const { data: user } = await admin
    .from("users")
    .select("id, email, full_name, role, status, phone, customer_id, created_at, customer:customers(name)")
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

  const [membershipsRes, allSitesRes, auditRes] = await Promise.all([
    admin
      .from("site_members")
      .select("id, role, site_id, sites(id, site_name, site_code, customer:customers(name))")
      .eq("user_id", id),
    admin
      .from("sites")
      .select("id, site_name, site_code, customer:customers(name)")
      .order("site_name"),
    admin
      .from("audit_logs")
      .select("id, created_at, action, field_name, old_value, new_value, actor_email, actor_full_name, actor_role")
      .eq("entity_type", "user")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const memberships = (membershipsRes.data || []) as unknown as {
    id: string;
    role: string;
    site_id: string;
    sites:
      | { id: string; site_name: string; site_code: string; customer: { name: string }[] | null }[]
      | { id: string; site_name: string; site_code: string; customer: { name: string }[] | null }
      | null;
  }[];
  const allSites = (allSitesRes.data || []) as unknown as {
    id: string;
    site_name: string;
    site_code: string;
    customer: { name: string }[] | null;
  }[];
  const audit = (auditRes.data || []) as unknown as {
    id: string;
    created_at: string;
    action: string;
    field_name: string | null;
    old_value: string | null;
    new_value: string | null;
    actor_email: string | null;
    actor_full_name: string | null;
    actor_role: string | null;
  }[];

  const customerData = Array.isArray(user.customer)
    ? user.customer[0]
    : user.customer;

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "sites", label: "Site Access", count: memberships.length },
    { key: "history", label: "History", count: audit.length },
  ];

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link
          href="/admin/users"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Users
        </Link>
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {user.full_name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {user.email}
              {user.phone && <span> · {user.phone}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
              {ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] || user.role}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                user.status === "active"
                  ? "bg-green-100 text-green-800"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {user.status}
            </span>
          </div>
        </div>
      </div>

      <DetailTabs
        current={activeTab}
        basePath={`/admin/users/${id}`}
        tabs={tabs}
      />

      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border p-6">
            <h2 className="text-base font-semibold text-foreground mb-4">
              User details
            </h2>
            <EditUserForm user={user} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border p-6">
              <p className="text-xs text-muted-foreground">Customer</p>
              <p className="text-base font-semibold mt-1">
                {customerData?.name || "—"}
              </p>
            </div>
            <div className="rounded-xl border border-border p-6">
              <p className="text-xs text-muted-foreground">Sites assigned</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">
                {memberships.length}
              </p>
            </div>
            <div className="rounded-xl border border-border p-6">
              <p className="text-xs text-muted-foreground">Joined</p>
              <p className="text-sm font-medium mt-1">
                {formatDate(user.created_at)}
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === "sites" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border p-6">
            <h2 className="text-base font-semibold text-foreground mb-4">
              Site Access ({memberships.length})
            </h2>
            {memberships.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sites assigned.
              </p>
            ) : (
              <div className="space-y-2">
                {memberships.map((m) => {
                  const siteData = Array.isArray(m.sites) ? m.sites[0] : m.sites;
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
                        <form
                          action={`/api/admin/site-members?action=remove&membershipId=${m.id}`}
                          method="POST"
                        >
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
                })}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border p-6">
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
                  {allSites.map((site) => {
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
                  <option value="viewer">Viewer</option>
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
      )}

      {activeTab === "history" && (
        <div className="rounded-xl border border-border overflow-hidden">
          {audit.length === 0 ? (
            <div className="p-6">
              <TableEmpty
                colSpan={1}
                icon="search"
                title="No history yet"
                description="Changes to this user will appear here."
              />
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    When
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Who
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Action
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Field
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Old → New
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {audit.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3 text-xs text-muted-foreground">
                      {formatDate(a.created_at)}
                    </td>
                    <td className="p-3 text-sm">
                      {a.actor_full_name || a.actor_email || "—"}
                    </td>
                    <td className="p-3 text-sm">{a.action}</td>
                    <td className="p-3 text-sm">{a.field_name || "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {a.old_value && (
                        <span className="line-through mr-1">{a.old_value}</span>
                      )}
                      {a.new_value && (
                        <span className="text-foreground">→ {a.new_value}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
