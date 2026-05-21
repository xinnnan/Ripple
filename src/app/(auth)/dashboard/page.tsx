import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { STATUS_LABELS } from "@/types/ticket";
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_COLORS } from "@/types/ticket";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import type { UserRole } from "@/types/ticket";

export const dynamic = "force-dynamic";

const INTERNAL_ROLES: UserRole[] = [
  "internal_admin",
  "internal_service_manager",
  "internal_engineer",
  "internal_solution_engineer",
];

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  // Get user role
  const { data: userProfile } = await supabase
    .from("users")
    .select("role, full_name")
    .eq("id", authUser.id)
    .single();

  const role = userProfile?.role as UserRole | undefined;
  const isInternal = role && INTERNAL_ROLES.includes(role);

  if (isInternal) {
    return <InternalDashboard />;
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
        .not("status", "in", '("resolved","closed")'),
      supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .is("owner_id", null)
        .not("status", "in", '("resolved","closed")'),
      supabase
        .from("tickets")
        .select(
          `
          ticket_no, title, severity, status, created_at,
          customer:customers(name),
          site:sites(site_name),
          owner:users!tickets_owner_id_fkey(full_name)
        `
        )
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const stats = [
    {
      label: "Open Tickets",
      value: openTickets.count ?? 0,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "P1 / P2 Critical",
      value: p1p2Tickets.count ?? 0,
      color: "text-red-600",
      bg: "bg-red-50",
    },
    {
      label: "Unassigned",
      value: unassignedTickets.count ?? 0,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of your support operations
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border p-6"
          >
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
        <div className="divide-y divide-border">
          {recentTickets.data?.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No tickets yet. Create one from Slack or the web portal.
            </div>
          ) : (
            recentTickets.data?.map(
              (ticket: {
                ticket_no: string;
                title: string;
                severity: string;
                status: string;
                created_at: string;
                customer: { name: string }[];
                site: { site_name: string }[];
                owner: { full_name: string }[];
              }) => (
                <Link
                  key={ticket.ticket_no}
                  href={`/tickets/${ticket.ticket_no}`}
                  className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-mono text-muted-foreground w-24">
                      {ticket.ticket_no}
                    </span>
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700">
                      {ticket.severity}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {ticket.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ticket.customer?.[0]?.name} ·{" "}
                        {ticket.site?.[0]?.site_name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                      {STATUS_LABELS[
                        ticket.status as keyof typeof STATUS_LABELS
                      ] || ticket.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {ticket.owner?.[0]?.full_name || "Unassigned"}
                    </span>
                    <span className="text-xs text-muted-foreground w-28 text-right">
                      {formatDate(ticket.created_at)}
                    </span>
                  </div>
                </Link>
              )
            )
          )}
        </div>
      </div>
    </div>
  );
}

async function CustomerDashboard({ userId }: { userId: string }) {
  const supabase = await createClient();

  // Get user's sites
  const { data: memberships } = await supabase
    .from("site_members")
    .select(
      `
      role,
      sites(
        id,
        site_name,
        site_code,
        project_status,
        customer:customers(name)
      )
    `
    )
    .eq("user_id", userId);

  interface CustomerSiteRow {
    id: string;
    site_name: string;
    site_code: string;
    project_status: string;
    customer: { name: string }[] | null;
  }

  const sites =
    memberships?.map((m) => {
      const s = (Array.isArray(m.sites) ? m.sites[0] : m.sites) as unknown as CustomerSiteRow;
      return { ...s, member_role: m.role };
    }) || [];

  const siteIds = sites.map((s) => s.id);

  // Get tickets for user's sites
  let recentTickets: {
    ticket_no: string;
    title: string;
    severity: string;
    status: string;
    created_at: string;
    site: { site_name: string }[] | null;
  }[] = [];

  let openCount = 0;

  if (siteIds.length > 0) {
    const [ticketsRes, countRes] = await Promise.all([
      supabase
        .from("tickets")
        .select(
          `
          ticket_no, title, severity, status, created_at,
          site:sites(site_name)
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
    ]);

    recentTickets = (ticketsRes.data || []) as unknown as typeof recentTickets;
    openCount = countRes.count ?? 0;
  }

  return (
    <div className="p-8">
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
            {recentTickets.length > 0 ? recentTickets.length : 0}
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
          <div className="p-6 text-center text-sm text-muted-foreground">
            No sites assigned yet. Contact your DropletAI Account Manager.
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
          <div className="p-6 text-center text-sm text-muted-foreground">
            No tickets yet.{" "}
            <Link
              href="/submit"
              className="text-primary hover:text-primary/80"
            >
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
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <span className="text-xs font-mono text-muted-foreground w-24">
                    {ticket.ticket_no}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {ticket.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ticket.site?.[0]?.site_name || "Unknown Site"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                    {STATUS_LABELS[
                      ticket.status as keyof typeof STATUS_LABELS
                    ] || ticket.status}
                  </span>
                  <span className="text-xs text-muted-foreground w-28 text-right">
                    {formatDate(ticket.created_at)}
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
