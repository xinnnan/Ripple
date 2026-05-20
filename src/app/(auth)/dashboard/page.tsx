import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
import { STATUS_LABELS, SEVERITY_LABELS } from "@/types/ticket";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = createAdminClient();

  // Fetch dashboard stats
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
                    <span
                      className={`severity-${ticket.severity} inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`}
                    >
                      {ticket.severity}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {ticket.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ticket.customer?.[0]?.name} · {ticket.site?.[0]?.site_name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span
                      className={`status-${ticket.status} inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`}
                    >
                      {STATUS_LABELS[ticket.status as keyof typeof STATUS_LABELS]}
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
