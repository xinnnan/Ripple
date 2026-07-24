import { createAdminClient } from "@/lib/supabase/admin";
import { getUserScope, scopeTickets, scopeSites } from "@/lib/supabase/scope";
import { redirect } from "next/navigation";
import { SEVERITY_LABELS, STATUS_LABELS, type Severity, type TicketStatus } from "@/types/ticket";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { TicketsPageHeader } from "./tickets-page-header";
import { TableEmpty } from "@/components/empty-state";
import {
  PAGE_SIZE,
  parseFilters,
  buildParams,
  type TicketFilterOptions,
} from "./ticket-filters.shared";
import { TicketListControls } from "./ticket-list-controls";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{
    q?: string;
    status?: string;
    severity?: string;
    customer?: string;
    site?: string;
    owner?: string;
    range?: string;
    page?: string;
  }>;
}

export default async function TicketsPage({ searchParams }: Props) {
  const raw = await searchParams;
  const filters = parseFilters(
    new URLSearchParams(
      Object.entries(raw).reduce<Record<string, string>>((acc, [k, v]) => {
        if (typeof v === "string") acc[k] = v;
        return acc;
      }, {})
    )
  );

  const scope = await getUserScope();
  if (!scope) redirect("/login");

  const admin = createAdminClient();

  // ---- Build the tickets query with all filters applied --------------------
  let query = admin
    .from("tickets")
    .select(
      `
      ticket_no, title, severity, status, request_type, created_at,
      customer:customers(id, name),
      site:sites(id, site_name),
      owner:users!tickets_owner_id_fkey(id, full_name)
    `,
      { count: "estimated" }
    )
    .order("created_at", { ascending: false });

  query = scopeTickets(query, scope);

  if (filters.status && filters.status.length > 0) {
    query = query.in("status", filters.status);
  }
  if (filters.severity && filters.severity.length > 0) {
    query = query.in("severity", filters.severity);
  }
  if (filters.customer_id) {
    // Either the caller's scope allows this customer, or we bail with 403-shaped empty result
    if (!scope.isInternal && scope.customerId !== filters.customer_id) {
      return renderTicketsPage(filters, [], 0, scope.isInternal, {
        customers: [],
        sites: [],
        owners: [],
        canFilterByCustomer: false,
        canFilterByOwner: false,
      });
    }
    query = query.eq("customer_id", filters.customer_id);
  }
  if (filters.site_id) {
    if (!scope.isInternal && !scope.siteIds.includes(filters.site_id)) {
      return renderTicketsPage(filters, [], 0, scope.isInternal, {
        customers: [],
        sites: [],
        owners: [],
        canFilterByCustomer: false,
        canFilterByOwner: false,
      });
    }
    query = query.eq("site_id", filters.site_id);
  }
  if (filters.owner_id) {
    if (!scope.isInternal) {
      // Customers / managers can't filter by owner
      return renderTicketsPage(filters, [], 0, scope.isInternal, {
        customers: [],
        sites: [],
        owners: [],
        canFilterByCustomer: false,
        canFilterByOwner: false,
      });
    }
    query = query.eq("owner_id", filters.owner_id);
  }
  if (filters.q) {
    // Escape any wildcards the user might have typed
    const safe = filters.q.replace(/[%_]/g, (m) => "\\" + m);
    // ticket_no is exact match (RPL-XXXXXX), title is fuzzy
    const orFilter = `ticket_no.ilike.%${safe}%,title.ilike.%${safe}%`;
    query = query.or(orFilter);
  }
  if (filters.range && filters.range !== "all") {
    const days = filters.range === "7d" ? 7 : filters.range === "30d" ? 30 : 90;
    const from = new Date();
    from.setDate(from.getDate() - days);
    query = query.gte("created_at", from.toISOString());
  }

  // Pagination
  const page = filters.page || 1;
  const fromIdx = (page - 1) * PAGE_SIZE;
  const toIdx = fromIdx + PAGE_SIZE - 1;
  query = query.range(fromIdx, toIdx);

  const { data: tickets, count } = await query;
  const totalCount = count ?? tickets?.length ?? 0;

  // ---- Build filter options (customers / sites / owners) for the UI --------
  const options = await loadFilterOptions(scope);

  return renderTicketsPage(
    filters,
    tickets || [],
    totalCount,
    scope.isInternal,
    options
  );
}

async function loadFilterOptions(
  scope: Awaited<ReturnType<typeof getUserScope>>
): Promise<TicketFilterOptions> {
  if (!scope) {
    return {
      customers: [],
      sites: [],
      owners: [],
      canFilterByCustomer: false,
      canFilterByOwner: false,
    };
  }

  const admin = createAdminClient();

  if (scope.isInternal) {
    // Internal: see all customers / sites / owners (owners = internal users
    // who have ever owned a ticket)
    const [customersRes, sitesRes, ownersRes] = await Promise.all([
      admin
        .from("customers")
        .select("id, name")
        .eq("status", "active")
        .order("name"),
      admin
        .from("sites")
        .select("id, site_name, site_code, customer_id")
        .eq("status", "active")
        .order("site_name"),
      // Distinct owners that have at least one ticket
      admin
        .from("users")
        .select("id, full_name")
        .in("role", ["admin", "engineer"])
        .eq("status", "active")
        .order("full_name"),
    ]);

    return {
      customers: customersRes.data || [],
      sites: sitesRes.data || [],
      owners: ownersRes.data || [],
      canFilterByCustomer: true,
      canFilterByOwner: true,
    };
  }

  // Manager / customer: only their own org's customers + their visible sites
  const [customersRes, sitesRes] = await Promise.all([
    scope.customerId
      ? admin
          .from("customers")
          .select("id, name")
          .eq("id", scope.customerId)
          .eq("status", "active")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    (async () => {
      let q = admin
        .from("sites")
        .select("id, site_name, site_code, customer_id")
        .eq("status", "active")
        .order("site_name");
      q = scopeSites(q, scope);
      return q;
    })(),
  ]);

  return {
    customers: customersRes.data || [],
    sites: sitesRes.data || [],
    owners: [],
    canFilterByCustomer: false,
    canFilterByOwner: false,
  };
}

function renderTicketsPage(
  filters: ReturnType<typeof parseFilters>,
  tickets: {
    ticket_no: string;
    title: string;
    severity: string;
    status: string;
    request_type: string;
    created_at: string;
    customer: { id?: string; name: string }[];
    site: { id?: string; site_name: string }[];
    owner: { id?: string; full_name: string }[];
  }[],
  totalCount: number,
  isInternal: boolean,
  options: TicketFilterOptions
) {
  const hasFilters = Boolean(
    filters.q ||
      (filters.status && filters.status.length > 0) ||
      (filters.severity && filters.severity.length > 0) ||
      filters.customer_id ||
      filters.site_id ||
      filters.owner_id ||
      (filters.range && filters.range !== "all")
  );

  return (
    <div className="p-8">
      <TicketsPageHeader
        filterQuery={buildParams(filters)}
        isInternal={isInternal}
      />

      <TicketListControls totalCount={totalCount} options={options} />

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
                Customer / Site
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
            {tickets.length === 0 ? (
              <TableEmpty
                colSpan={7}
                icon="ticket"
                title="No tickets match"
                description={
                  hasFilters
                    ? "Try adjusting the filters above or clearing them."
                    : isInternal
                    ? "When tickets are created they will appear here."
                    : "When you submit a ticket, it will appear here."
                }
                action={
                  hasFilters
                    ? { label: "Clear filters", href: "/tickets" }
                    : isInternal
                    ? undefined
                    : { label: "Submit a ticket", href: "/submit" }
                }
              />
            ) : (
              tickets.map((ticket) => (
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
                      {SEVERITY_LABELS[ticket.severity as Severity] ||
                        ticket.severity}
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
                      {STATUS_LABELS[ticket.status as TicketStatus] ||
                        ticket.status}
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
