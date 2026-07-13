import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_COLORS,
  STATUS_LABELS,
  type Severity,
  type TicketStatus,
} from "@/types/ticket";
import { EditSiteForm } from "./edit-site-form";
import { DetailTabs, getCurrentTab } from "@/components/detail-tabs";
import { TableEmpty } from "@/components/empty-state";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function AdminSiteDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab = getCurrentTab({ tab }, "overview");

  const supabase = createAdminClient();

  // Get site details
  const { data: site } = await supabase
    .from("sites")
    .select(
      `
      id,
      site_name,
      site_code,
      customer_id,
      timezone,
      address,
      slack_channel_id,
      default_owner_id,
      status,
      project_status,
      created_at,
      customer:customers(id, name)
    `
    )
    .eq("id", id)
    .single();

  if (!site) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Site not found.</p>
        <Link
          href="/admin/sites"
          className="text-sm font-medium text-primary hover:text-primary/80 mt-4 inline-block"
        >
          ← Back to Sites
        </Link>
      </div>
    );
  }

  // Run all per-tab data fetches in parallel
  const [membersRes, customersRes, ticketsRes, auditRes, partRequestsRes, inventoryRes] =
    await Promise.all([
      supabase
        .from("site_members")
        .select(`id, role, user_id, users(id, email, full_name, role)`)
        .eq("site_id", id),
      supabase.from("customers").select("id, name").order("name"),
      supabase
        .from("tickets")
        .select(
          "ticket_no, title, severity, status, request_type, created_at, customer:customers(name)"
        )
        .eq("site_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("audit_logs")
        .select("id, created_at, action, field_name, old_value, new_value, actor_email, actor_full_name, actor_role")
        .eq("entity_type", "site")
        .eq("entity_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("spare_part_inventory")
        .select(
          "id, quantity, location, spare_part:spare_parts(id, part_name, part_number, category)"
        )
        .eq("site_id", id),
      // no-op placeholder, kept parallel; part_requests without site link
      Promise.resolve({ data: [] }),
    ]);

  const members = (membersRes.data || []) as unknown as {
    id: string;
    role: string;
    user_id: string;
    users: { id: string; email: string; full_name: string; role: string }[] | null;
  }[];
  const customers = customersRes.data || [];
  const tickets = (ticketsRes.data || []) as unknown as {
    ticket_no: string;
    title: string;
    severity: string;
    status: string;
    request_type: string;
    created_at: string;
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
  const inventory = (inventoryRes.data || []) as unknown as {
    id: string;
    quantity: number;
    location: string | null;
    spare_part: { id: string; part_name: string; part_number: string; category: string } | { id: string; part_name: string; part_number: string; category: string }[] | null;
  }[];
  const inventoryCount = inventory.length;
  const openTicketCount = tickets.filter(
    (t) => !["resolved", "closed"].includes(t.status)
  ).length;

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "tickets", label: "Tickets", count: tickets.length },
    { key: "members", label: "Members", count: members.length },
    { key: "inventory", label: "Inventory", count: inventoryCount },
    { key: "slack", label: "Slack" },
    { key: "history", label: "History", count: audit.length },
  ];

  const customerData = Array.isArray(site.customer) ? site.customer[0] : site.customer;

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link
          href="/admin/sites"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Sites
        </Link>
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {site.site_name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 font-mono">
              {site.site_code}
              {customerData ? ` · ${customerData.name}` : ""}
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              PROJECT_STATUS_COLORS[
                site.project_status as keyof typeof PROJECT_STATUS_COLORS
              ] || "bg-gray-100 text-gray-800"
            }`}
          >
            {PROJECT_STATUS_LABELS[
              site.project_status as keyof typeof PROJECT_STATUS_LABELS
            ] || site.project_status}
          </span>
        </div>
      </div>

      <DetailTabs
        current={activeTab}
        basePath={`/admin/sites/${id}`}
        tabs={tabs}
      />

      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border p-6">
            <h2 className="text-base font-semibold text-foreground mb-4">
              Site details
            </h2>
            <EditSiteForm site={site} customers={customers} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border p-6">
              <p className="text-xs text-muted-foreground">Open tickets</p>
              <p className="text-3xl font-bold text-amber-600 mt-1">
                {openTicketCount}
              </p>
              <Link
                href={`/tickets?site=${id}`}
                className="text-xs text-primary hover:text-primary/80 mt-2 inline-block"
              >
                View all →
              </Link>
            </div>
            <div className="rounded-xl border border-border p-6">
              <p className="text-xs text-muted-foreground">Members</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">
                {members.length}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Customer users assigned to this site
              </p>
            </div>
            <div className="rounded-xl border border-border p-6">
              <p className="text-xs text-muted-foreground">Spare parts on site</p>
              <p className="text-3xl font-bold text-purple-600 mt-1">
                {inventoryCount}
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === "tickets" && (
        <div className="rounded-xl border border-border overflow-hidden">
          {tickets.length === 0 ? (
            <div className="p-6">
              <TableEmpty
                colSpan={1}
                icon="ticket"
                title="No tickets for this site yet"
                description="When customers submit tickets, they'll appear here."
              />
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Ticket
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Severity
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Title
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Status
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tickets.map((t) => (
                  <tr key={t.ticket_no} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3">
                      <Link
                        href={`/tickets/${t.ticket_no}`}
                        className="text-xs font-mono font-medium text-primary hover:text-primary/80"
                      >
                        {t.ticket_no}
                      </Link>
                    </td>
                    <td className="p-3">
                      <span
                        className={`severity-${t.severity} inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`}
                      >
                        {t.severity}
                      </span>
                    </td>
                    <td className="p-3">
                      <p className="text-sm max-w-xs truncate">{t.title}</p>
                    </td>
                    <td className="p-3">
                      <span
                        className={`status-${t.status} inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`}
                      >
                        {STATUS_LABELS[t.status as TicketStatus] || t.status}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {formatDate(t.created_at, site.timezone)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "members" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border p-6">
            <h2 className="text-base font-semibold text-foreground mb-4">
              Site Members ({members.length})
            </h2>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No members assigned to this site.
              </p>
            ) : (
              <div className="space-y-2">
                {members.map((m) => {
                  const userData = Array.isArray(m.users) ? m.users[0] : m.users;
                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {userData?.full_name || "Unnamed"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {userData?.email}
                          {userData?.role && (
                            <span className="ml-2 capitalize">
                              · {userData.role}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground capitalize">
                          site role: {m.role}
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
              Add Member
            </h3>
            <form
              action={`/api/admin/site-members?siteId=${id}`}
              method="POST"
              className="flex items-end gap-3"
            >
              <div className="flex-1">
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  User ID
                </label>
                <input
                  type="text"
                  name="user_id"
                  placeholder="Enter user UUID..."
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
                />
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
                  <option value="admin">Admin</option>
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

      {activeTab === "inventory" && (
        <div className="rounded-xl border border-border overflow-hidden">
          {inventory.length === 0 ? (
            <div className="p-6">
              <TableEmpty
                colSpan={1}
                icon="package"
                title="No spare parts on site"
                description="When spare parts are stocked at this site, they will appear here."
              />
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Part
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Part #
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Quantity
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Location
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {inventory.map((inv) => {
                  const part = Array.isArray(inv.spare_part)
                    ? inv.spare_part[0]
                    : inv.spare_part;
                  return (
                    <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3 text-sm font-medium">
                        {part?.part_name || "—"}
                      </td>
                      <td className="p-3 text-xs font-mono text-muted-foreground">
                        {part?.part_number || "—"}
                      </td>
                      <td className="p-3 text-sm font-semibold">
                        {inv.quantity}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {inv.location || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "slack" && (
        <div className="rounded-xl border border-border p-6">
          <h2 className="text-base font-semibold text-foreground mb-4">
            Slack Channel
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Linked Channel
                </p>
                <p className="text-xs text-muted-foreground">
                  {site.slack_channel_id
                    ? `${site.slack_channel_id}`
                    : "No channel linked"}
                </p>
              </div>
              <Link
                href={`/admin/sites/${id}/slack`}
                className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {site.slack_channel_id ? "Change Channel" : "Link Channel"}
              </Link>
            </div>
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
                description="Changes to this site will appear here."
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
