import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
import { STATUS_LABELS, SEVERITY_LABELS } from "@/types/ticket";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { TicketsPageHeader } from "./tickets-page-header";

function buildFilterQuery(filters: { status?: string; severity?: string }) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.severity) params.set("severity", filters.severity);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

interface Props {
  searchParams: Promise<{ status?: string; severity?: string }>;
}

export default async function TicketsPage({ searchParams }: Props) {
  const filters = await searchParams;
  const supabase = createAdminClient();

  let query = supabase
    .from("tickets")
    .select(
      `
      ticket_no, title, severity, status, request_type, created_at,
      customer:customers(name),
      site:sites(site_name),
      owner:users!tickets_owner_id_fkey(full_name)
    `
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.severity) query = query.eq("severity", filters.severity);

  const { data: tickets } = await query;

  return (
    <div className="p-8">
      <TicketsPageHeader filterQuery={buildFilterQuery(filters)} />

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        <Link
          href="/tickets"
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            !filters.status
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:bg-accent"
          }`}
        >
          All
        </Link>
        {["new", "in_progress", "waiting_customer", "resolved"].map(
          (status) => (
            <Link
              key={status}
              href={`/tickets?status=${status}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filters.status === status
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {STATUS_LABELS[status as keyof typeof STATUS_LABELS]}
            </Link>
          )
        )}
      </div>

      {/* Ticket Table */}
      <div className="rounded-xl border border-border overflow-hidden">
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
                Customer
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Status
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Owner
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tickets?.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="p-8 text-center text-sm text-muted-foreground"
                >
                  No tickets found.
                </td>
              </tr>
            ) : (
              tickets?.map(
                (ticket: {
                  ticket_no: string;
                  title: string;
                  severity: string;
                  status: string;
                  request_type: string;
                  created_at: string;
                  customer: { name: string }[];
                  site: { site_name: string }[];
                  owner: { full_name: string }[];
                }) => (
                  <tr
                    key={ticket.ticket_no}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="p-3">
                      <Link
                        href={`/tickets/${ticket.ticket_no}`}
                        className="text-xs font-mono font-medium text-primary hover:text-primary/80"
                      >
                        {ticket.ticket_no}
                      </Link>
                    </td>
                    <td className="p-3">
                      <span
                        className={`severity-${ticket.severity} inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`}
                      >
                        {ticket.severity}
                      </span>
                    </td>
                    <td className="p-3">
                      <p className="text-sm text-foreground max-w-xs truncate">
                        {ticket.title}
                      </p>
                    </td>
                    <td className="p-3">
                      <p className="text-sm text-foreground">
                        {ticket.customer?.[0]?.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ticket.site?.[0]?.site_name}
                      </p>
                    </td>
                    <td className="p-3">
                      <span
                        className={`status-${ticket.status} inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`}
                      >
                        {STATUS_LABELS[ticket.status as keyof typeof STATUS_LABELS]}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="text-sm text-muted-foreground">
                        {ticket.owner?.[0]?.full_name || "—"}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="text-xs text-muted-foreground">
                        {formatDate(ticket.created_at)}
                      </span>
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
