import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { STATUS_LABELS } from "@/types/ticket";
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_COLORS } from "@/types/ticket";
import {
  formatDate,
  resolveSiteTimezone,
  singleRelation,
} from "@/lib/utils";
import { isCustomerManager, isInternalUser } from "@/lib/roles";
import Link from "next/link";
import type { UserRole } from "@/types/ticket";
import { assertPageQueriesSucceeded } from "@/lib/server-page-query";

export const dynamic = "force-dynamic";

interface DashboardRecentTicket {
  ticket_no: string;
  title: string;
  severity: string;
  status: string;
  created_at: string;
  site:
    | { site_name: string; timezone: string }[]
    | { site_name: string; timezone: string }
    | null;
}

interface OpenTicketBySiteRow {
  site_id: string;
  sites:
    | { id: string; site_name: string; site_code: string }[]
    | { id: string; site_name: string; site_code: string }
    | null;
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  // Get user role
  const profileResult = await supabase
    .from("users")
    .select("role, full_name, email, customer_id")
    .eq("id", authUser.id)
    .maybeSingle();
  assertPageQueriesSucceeded("dashboard/profile", profileResult);
  const userProfile = profileResult.data;

  const role = userProfile?.role as UserRole | undefined;
  const email = userProfile?.email as string | undefined;
  const customerId = userProfile?.customer_id as string | null;
  const isInternal = isInternalUser({ role, email });


  const isManager = role ? isCustomerManager(role) : false;

  if (isInternal) {
    return <InternalDashboard />;
  } else if (isManager && customerId) {
    return <CustomerManagerDashboard userId={authUser.id} customerId={customerId} />;
  } else {
    return <CustomerDashboard userId={authUser.id} />;
  }
}

async function InternalDashboard() {
  const supabase = createAdminClient();

  const [openTickets, p1p2Tickets, unassignedTickets, recentTickets] =
    await Promise.all([
      supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .in("status", [
          "new",
          "assigned",
          "in_progress",
          "waiting_customer",
          "waiting_droplet",
          "reopened",
        ]),
      supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .in("severity", ["P1", "P2"])
        .in("status", [
          "new",
          "assigned",
          "in_progress",
          "waiting_customer",
          "waiting_droplet",
          "reopened",
        ]),
      supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .is("owner_id", null)
        .in("status", ["new", "assigned", "reopened"]),
      supabase
        .from("tickets")
        .select(
          `
          ticket_no, title, severity, status, created_at,
          customer:customers(name),
          site:sites(site_name, timezone)
        `
        )
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
  assertPageQueriesSucceeded(
    "dashboard/internal",
    openTickets,
    p1p2Tickets,
    unassignedTickets,
    recentTickets
  );

  const stats = [
    {
      label: "Open Tickets",
      value: openTickets.count ?? 0,
      color: "text-blue-600",
    },
    {
      label: "P1/P2 Active",
      value: p1p2Tickets.count ?? 0,
      color: "text-red-600",
    },
    {
      label: "Unassigned",
      value: unassignedTickets.count ?? 0,
      color: "text-amber-600",
    },
  ];

  return (
    <div className="p-5 sm:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Internal overview of all support activity.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border p-6">
            <p className="text-sm text-muted-foreground">{stat.label}</p>
            <p className={`text-3xl font-bold mt-1 ${stat.color}`}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Recent Tickets */}
      <div className="rounded-xl border border-border">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            Recent Tickets
          </h2>
          <Link
            href="/tickets"
            className="text-sm font-medium text-primary hover:text-primary/80"
          >
            View all →
          </Link>
        </div>
        {recentTickets.data?.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No tickets yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recentTickets.data?.map(
              (ticket: {
                ticket_no: string;
                title: string;
                severity: string;
                status: string;
                created_at: string;
                customer: { name: string }[] | { name: string } | null;
                site:
                  | { site_name: string; timezone: string }[]
                  | { site_name: string; timezone: string }
                  | null;
              }) => (
                <Link
                  key={ticket.ticket_no}
                  href={`/tickets/${ticket.ticket_no}`}
                  className="grid gap-3 p-4 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0 sm:flex sm:items-center sm:gap-4">
                    <span className="mb-1 block shrink-0 text-xs font-mono text-muted-foreground sm:mb-0 sm:w-24">
                      {ticket.ticket_no}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-foreground">
                        {ticket.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {singleRelation(ticket.customer)?.name || "Unknown"},{" "}
                        {singleRelation(ticket.site)?.site_name || "Unknown Site"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-4">
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                      {STATUS_LABELS[ticket.status as keyof typeof STATUS_LABELS] || ticket.status}
                    </span>
                    <span className="text-right text-xs text-muted-foreground sm:w-28">
                      {formatDate(
                        ticket.created_at,
                        resolveSiteTimezone(ticket.site)
                      )}
                    </span>
                  </div>
                </Link>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Customer Manager Dashboard — sees all sites and tickets under their customer.
 */
async function CustomerManagerDashboard({ customerId }: { userId: string; customerId: string }) {
  const supabase = createAdminClient();

  // Get all sites under this customer
  const sitesResult = await supabase
    .from("sites")
    .select(
      "id, site_name, site_code, project_status, customer:customers!inner(id)"
    )
    .eq("customer_id", customerId)
    .eq("status", "active")
    .in("customer.status", ["active", "trial"]);
  assertPageQueriesSucceeded("dashboard/customer-manager-sites", sitesResult);
  const sites = (sitesResult.data || []).map((site) => ({
    id: site.id,
    site_name: site.site_name,
    site_code: site.site_code,
    project_status: site.project_status,
  }));

  const siteIds = sites.map((site) => site.id);

  let recentTickets: DashboardRecentTicket[] = [];
  let openCount = 0;
  let p1p2Count = 0;
  let openBySiteRows: OpenTicketBySiteRow[] = [];

  if (siteIds.length > 0) {
    const [ticketsResult, openResult, openBySiteResult, p1p2Result] =
      await Promise.all([
        supabase
          .from("tickets")
          .select(
            `
            ticket_no, title, severity, status, created_at,
            site:sites(site_name, timezone)
          `
          )
          .in("site_id", siteIds)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .in("site_id", siteIds)
          .in("status", [
            "new",
            "assigned",
            "in_progress",
            "waiting_customer",
            "waiting_droplet",
            "reopened",
          ]),
        // Open tickets grouped by site (org-centric view)
        supabase
          .from("tickets")
          .select("site_id, sites(id, site_name, site_code)")
          .in("site_id", siteIds)
          .in("status", [
            "new",
            "assigned",
            "in_progress",
            "waiting_customer",
            "waiting_droplet",
            "reopened",
          ]),
        // P1/P2 active for SLA-at-a-glance
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .in("site_id", siteIds)
          .in("severity", ["P1", "P2"])
          .in("status", [
            "new",
            "assigned",
            "in_progress",
            "waiting_customer",
            "waiting_droplet",
            "reopened",
          ]),
      ]);
    assertPageQueriesSucceeded(
      "dashboard/customer-manager-tickets",
      ticketsResult,
      openResult,
      openBySiteResult,
      p1p2Result
    );
    recentTickets = (ticketsResult.data || []) as unknown as DashboardRecentTicket[];
    openCount = openResult.count ?? 0;
    p1p2Count = p1p2Result.count ?? 0;
    openBySiteRows = (openBySiteResult.data || []) as unknown as OpenTicketBySiteRow[];
  }

  // Aggregate open tickets per site
  const openBySite = new Map<string, { name: string; code: string; count: number }>();
  openBySiteRows.forEach((row) => {
    const s = singleRelation(row.sites);
    if (!s) return;
    const existing = openBySite.get(s.id);
    if (existing) {
      existing.count++;
    } else {
      openBySite.set(s.id, { name: s.site_name, code: s.site_code, count: 1 });
    }
  });
  const topSitesByOpen = Array.from(openBySite.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Get team members count
  const teamCountResult = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("status", "active");
  assertPageQueriesSucceeded(
    "dashboard/customer-manager-team-count",
    teamCountResult
  );
  const teamCount = teamCountResult.count;

  return (
    <div className="p-5 sm:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of your organization’s support activity.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
        <div className="rounded-xl border border-border p-6">
          <p className="text-sm text-muted-foreground">Sites</p>
          <p className="text-3xl font-bold mt-1 text-blue-600">
            {sites?.length ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-border p-6">
          <p className="text-sm text-muted-foreground">Open Tickets</p>
          <p className="text-3xl font-bold mt-1 text-amber-600">
            {openCount}
          </p>
        </div>
        <div className="rounded-xl border border-border p-6">
          <p className="text-sm text-muted-foreground">P1 / P2 Active</p>
          <p className="text-3xl font-bold mt-1 text-red-600">
            {p1p2Count}
          </p>
        </div>
        <div className="rounded-xl border border-border p-6">
          <p className="text-sm text-muted-foreground">Team Members</p>
          <p className="text-3xl font-bold mt-1 text-purple-600">
            {teamCount ?? 0}
          </p>
        </div>
      </div>

      {/* Sites needing attention */}
      {topSitesByOpen.length > 0 && (
        <div className="rounded-xl border border-border mb-8">
          <div className="p-6 border-b border-border flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">
              Sites needing attention
            </h2>
            <span className="text-xs text-muted-foreground">
              by open ticket count
            </span>
          </div>
          <div className="divide-y divide-border">
            {topSitesByOpen.map((s) => (
              <Link
                key={s.id}
                href={`/tickets?site=${s.id}`}
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {s.name}
                  </p>
                  <p className="text-xs font-mono text-muted-foreground">
                    {s.code}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-semibold text-amber-600">
                    {s.count}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    open
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Sites */}
      <div className="rounded-xl border border-border mb-8">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">All Sites</h2>
          <Link
            href="/sites"
            className="text-sm font-medium text-primary hover:text-primary/80"
          >
            View all →
          </Link>
        </div>
        {(!sites || sites.length === 0) ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No sites found.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sites.map((site) => {
              const statusColor =
                PROJECT_STATUS_COLORS[site.project_status as keyof typeof PROJECT_STATUS_COLORS] || "bg-gray-100 text-gray-800";
              const statusLabel =
                PROJECT_STATUS_LABELS[site.project_status as keyof typeof PROJECT_STATUS_LABELS] || site.project_status;
              return (
                <div key={site.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">{site.site_name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{site.site_code}</p>
                  </div>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}>
                    {statusLabel}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Tickets */}
      <div className="rounded-xl border border-border">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Recent Tickets</h2>
          <Link
            href="/tickets"
            className="text-sm font-medium text-primary hover:text-primary/80"
          >
            View all →
          </Link>
        </div>
        {recentTickets.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No tickets yet.{" "}
            <Link href="/submit" className="text-primary hover:text-primary/80">
              Submit a request
            </Link>{" "}
            to get started.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recentTickets.map((ticket) => (
              <Link
                key={ticket.ticket_no}
                href={`/tickets/${ticket.ticket_no}`}
                className="grid gap-3 p-4 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0 sm:flex sm:items-center sm:gap-4">
                  <span className="mb-1 block shrink-0 text-xs font-mono text-muted-foreground sm:mb-0 sm:w-24">
                    {ticket.ticket_no}
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-foreground">{ticket.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {singleRelation(ticket.site)?.site_name || "Unknown Site"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-4">
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                    {STATUS_LABELS[ticket.status as keyof typeof STATUS_LABELS] || ticket.status}
                  </span>
                  <span className="text-right text-xs text-muted-foreground sm:w-28">
                    {formatDate(
                      ticket.created_at,
                      resolveSiteTimezone(ticket.site)
                    )}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

async function CustomerDashboard({ userId }: { userId: string }) {
  const supabase = createAdminClient();

  // Membership rows are retained for history. Resolve them through current
  // active tenant/site rows before they become dashboard scope.
  const membershipsResult = await supabase
    .from("site_members")
    .select("site_id")
    .eq("user_id", userId);
  assertPageQueriesSucceeded("dashboard/customer-memberships", membershipsResult);

  interface CustomerSiteRow {
    id: string;
    site_name: string;
    site_code: string;
    project_status: string;
  }

  const memberSiteIds = [
    ...new Set(
      (membershipsResult.data || []).map((membership) => membership.site_id)
    ),
  ];
  let sites: CustomerSiteRow[] = [];

  if (memberSiteIds.length > 0) {
    const sitesResult = await supabase
      .from("sites")
      .select(
        "id, site_name, site_code, project_status, customer:customers!inner(id)"
      )
      .in("id", memberSiteIds)
      .eq("status", "active")
      .in("customer.status", ["active", "trial"])
      .order("site_name");
    assertPageQueriesSucceeded("dashboard/customer-sites", sitesResult);
    sites = (sitesResult.data || []).map((site) => ({
      id: site.id,
      site_name: site.site_name,
      site_code: site.site_code,
      project_status: site.project_status,
    }));
  }

  const siteIds = sites.map((s) => s.id);

  // Get tickets for user's sites
  let recentTickets: {
    ticket_no: string;
    title: string;
    severity: string;
    status: string;
    created_at: string;
    site:
      | { site_name: string; timezone: string }[]
      | { site_name: string; timezone: string }
      | null;
  }[] = [];

  let openCount = 0;
  let totalCount = 0;

  if (siteIds.length > 0) {
    const [ticketsRes, openCountRes, totalCountRes] = await Promise.all([
      supabase
        .from("tickets")
        .select(
          `
          ticket_no, title, severity, status, created_at,
          site:sites(site_name, timezone)
        `
        )
        .in("site_id", siteIds)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .in("site_id", siteIds)
        .in("status", [
          "new",
          "assigned",
          "in_progress",
          "waiting_customer",
          "waiting_droplet",
          "reopened",
        ]),
      supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .in("site_id", siteIds),
    ]);
    assertPageQueriesSucceeded(
      "dashboard/customer-tickets",
      ticketsRes,
      openCountRes,
      totalCountRes
    );

    recentTickets = (ticketsRes.data || []) as unknown as typeof recentTickets;
    openCount = openCountRes.count ?? 0;
    totalCount = totalCountRes.count ?? 0;
  }

  return (
    <div className="p-5 sm:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Welcome back! Here is an overview of your support activity.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="rounded-xl border border-border p-6">
          <p className="text-sm text-muted-foreground">My Sites</p>
          <p className="text-3xl font-bold mt-1 text-blue-600">
            {sites.length}
          </p>
        </div>
        <div className="rounded-xl border border-border p-6">
          <p className="text-sm text-muted-foreground">Open Tickets</p>
          <p className="text-3xl font-bold mt-1 text-amber-600">
            {openCount}
          </p>
        </div>
        <div className="rounded-xl border border-border p-6">
          <p className="text-sm text-muted-foreground">Total Tickets</p>
          <p className="text-3xl font-bold mt-1 text-green-600">
            {totalCount}
          </p>
        </div>
      </div>

      {/* My Sites */}
      <div className="rounded-xl border border-border mb-8">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">My Sites</h2>
          <Link
            href="/sites"
            className="text-sm font-medium text-primary hover:text-primary/80"
          >
            View all →
          </Link>
        </div>
        {sites.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
              <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">
              No sites assigned to you yet
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Ask your Customer Manager to assign you to a site, or contact
              your DropletAI Account Manager to get set up.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
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
                <div
                  key={site.id}
                  className="flex items-center justify-between p-4"
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {site.site_name}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {site.site_code}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}
                  >
                    {statusLabel}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Tickets */}
      <div className="rounded-xl border border-border">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            Recent Tickets
          </h2>
          <Link
            href="/tickets"
            className="text-sm font-medium text-primary hover:text-primary/80"
          >
            View all →
          </Link>
        </div>
        {recentTickets.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
              <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">
              No tickets yet
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
              When you submit a ticket, it will appear here so you can track
              its progress.
            </p>
            <Link
              href="/submit"
              className="inline-block rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Submit a ticket
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recentTickets.map((ticket) => (
              <Link
                key={ticket.ticket_no}
                href={`/tickets/${ticket.ticket_no}`}
                className="grid gap-3 p-4 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0 sm:flex sm:items-center sm:gap-4">
                  <span className="mb-1 block shrink-0 text-xs font-mono text-muted-foreground sm:mb-0 sm:w-24">
                    {ticket.ticket_no}
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-foreground">
                      {ticket.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {singleRelation(ticket.site)?.site_name || "Unknown Site"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-4">
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                    {STATUS_LABELS[
                      ticket.status as keyof typeof STATUS_LABELS
                    ] || ticket.status}
                  </span>
                  <span className="text-right text-xs text-muted-foreground sm:w-28">
                    {formatDate(
                      ticket.created_at,
                      resolveSiteTimezone(ticket.site)
                    )}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
