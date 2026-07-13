import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_COLORS,
  STATUS_LABELS,
  type TicketStatus,
  type Severity,
} from "@/types/ticket";
import { EditCustomerForm } from "./edit-customer-form";
import { CreateSiteForm } from "../../sites/create-site-form";
import { DetailTabs, getCurrentTab } from "@/components/detail-tabs";
import { TableEmpty } from "@/components/empty-state";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function AdminCustomerDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab = getCurrentTab({ tab }, "overview");

  const admin = createAdminClient();

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

  const [sitesRes, ticketsRes, auditRes, teamRes] = await Promise.all([
    admin
      .from("sites")
      .select("id, site_name, site_code, status, project_status, timezone, slack_channel_id")
      .eq("customer_id", id)
      .order("site_name"),
    admin
      .from("tickets")
      .select("ticket_no, title, severity, status, request_type, created_at, site:sites(site_name)")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("audit_logs")
      .select("id, created_at, action, field_name, old_value, new_value, actor_email, actor_full_name, actor_role")
      .eq("entity_type", "customer")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("users")
      .select("id, email, full_name, role, status")
      .eq("customer_id", id)
      .order("full_name"),
  ]);

  const sites = sitesRes.data || [];
  const tickets = (ticketsRes.data || []) as unknown as {
    ticket_no: string;
    title: string;
    severity: string;
    status: string;
    request_type: string;
    created_at: string;
    site: { site_name: string }[] | null;
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
  const team = (teamRes.data || []) as unknown as {
    id: string;
    email: string;
    full_name: string;
    role: string;
    status: string;
  }[];

  const siteIds = sites.map((s) => s.id);
  const openTicketCount = tickets.filter(
    (t) => !["resolved", "closed"].includes(t.status)
  ).length;

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "sites", label: "Sites", count: sites.length },
    { key: "tickets", label: "Tickets", count: tickets.length },
    { key: "team", label: "Team", count: team.length },
    { key: "history", label: "History", count: audit.length },
  ];

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link
          href="/admin/customers"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Customers
        </Link>
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {customer.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {customer.domain || "No domain"} · customer since{" "}
              {formatDate(customer.created_at)}
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              customer.status === "active"
                ? "bg-green-100 text-green-800"
                : customer.status === "trial"
                ? "bg-yellow-100 text-yellow-800"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            {customer.status}
          </span>
        </div>
      </div>

      <DetailTabs
        current={activeTab}
        basePath={`/admin/customers/${id}`}
        tabs={tabs}
      />

      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border p-6">
            <h2 className="text-base font-semibold text-foreground mb-4">
              Customer details
            </h2>
            <EditCustomerForm customer={customer} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-border p-6">
              <p className="text-xs text-muted-foreground">Sites</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">
                {sites.length}
              </p>
            </div>
            <div className="rounded-xl border border-border p-6">
              <p className="text-xs text-muted-foreground">Open tickets</p>
              <p className="text-3xl font-bold text-amber-600 mt-1">
                {openTicketCount}
              </p>
            </div>
            <div className="rounded-xl border border-border p-6">
              <p className="text-xs text-muted-foreground">Total tickets</p>
              <p className="text-3xl font-bold text-green-600 mt-1">
                {tickets.length}
              </p>
            </div>
            <div className="rounded-xl border border-border p-6">
              <p className="text-xs text-muted-foreground">Team members</p>
              <p className="text-3xl font-bold text-purple-600 mt-1">
                {team.length}
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === "sites" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">
              Sites ({sites.length})
            </h2>
            <CreateSiteForm
              customers={[{ id: customer.id, name: customer.name }]}
              defaultCustomerId={customer.id}
              defaultCustomerName={customer.name}
              compact
            />
          </div>
          {sites.length === 0 ? (
            <TableEmpty
              colSpan={1}
              icon="search"
              title="No sites yet"
              description="Use the Add Site button above to create the first site for this customer."
            />
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left text-xs font-medium text-muted-foreground p-3">
                      Site
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground p-3">
                      Code
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground p-3">
                      Project status
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground p-3">
                      Slack
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sites.map((site) => (
                    <tr
                      key={site.id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="p-3">
                        <Link
                          href={`/admin/sites/${site.id}`}
                          className="text-sm font-medium text-primary hover:text-primary/80"
                        >
                          {site.site_name}
                        </Link>
                      </td>
                      <td className="p-3 text-xs font-mono text-muted-foreground">
                        {site.site_code}
                      </td>
                      <td className="p-3">
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
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {site.slack_channel_id ? (
                          <span className="text-green-600">Linked ✓</span>
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "tickets" && (
        <div className="rounded-xl border border-border overflow-hidden">
          {tickets.length === 0 ? (
            <div className="p-6">
              <TableEmpty
                colSpan={1}
                icon="ticket"
                title="No tickets yet"
                description="Tickets raised by this customer will appear here."
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
                    Site
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
                {tickets.map((t) => {
                  const site = Array.isArray(t.site) ? t.site[0] : t.site;
                  return (
                    <tr
                      key={t.ticket_no}
                      className="hover:bg-muted/30 transition-colors"
                    >
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
                      <td className="p-3 text-sm max-w-xs truncate">
                        {t.title}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {site?.site_name || "—"}
                      </td>
                      <td className="p-3">
                        <span
                          className={`status-${t.status} inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`}
                        >
                          {STATUS_LABELS[t.status as TicketStatus] || t.status}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {formatDate(t.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "team" && (
        <div className="rounded-xl border border-border overflow-hidden">
          {team.length === 0 ? (
            <div className="p-6">
              <TableEmpty
                colSpan={1}
                icon="users"
                title="No team members"
                description="Add users to this customer's organization from the Users page."
                action={{ label: "Manage Users", href: "/admin/users" }}
              />
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Name
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Email
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Role
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">
                    Status
                  </th>
                  <th className="text-right text-xs font-medium text-muted-foreground p-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {team.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3 text-sm font-medium">{u.full_name}</td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {u.email}
                    </td>
                    <td className="p-3">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 capitalize">
                        {u.role.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {u.status}
                    </td>
                    <td className="p-3 text-right">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="text-sm font-medium text-primary hover:text-primary/80"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
                description="Changes to this customer will appear here."
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
