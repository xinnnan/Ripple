import { createAdminClient } from "@/lib/supabase/admin";
import { SPR_STATUS_LABELS, SPR_STATUS_COLORS, SPR_PRIORITY_LABELS } from "@/types/spare-parts";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface PartRequestRow {
  id: string;
  request_no: string;
  status: string;
  priority: string;
  total_cost: number | null;
  created_at: string;
  site: { id: string; site_name: string; site_code: string }[] | { id: string; site_name: string; site_code: string } | null;
  ticket: { id: string; ticket_no: string; title: string }[] | { id: string; ticket_no: string; title: string } | null;
  requester: { id: string; full_name: string }[] | { id: string; full_name: string } | null;
  items: { quantity: number }[];
}

function getSiteName(site: PartRequestRow["site"]): string {
  if (!site) return "—";
  const s = Array.isArray(site) ? site[0] : site;
  return s?.site_name || "—";
}

function getTicketNo(ticket: PartRequestRow["ticket"]): string | null {
  if (!ticket) return null;
  const t = Array.isArray(ticket) ? ticket[0] : ticket;
  return t?.ticket_no || null;
}

export default async function PartRequestsPage() {
  const supabase = createAdminClient();

  const { data: requests } = await supabase
    .from("spare_part_requests")
    .select(`
      id, request_no, status, priority, total_cost, created_at,
      site:sites(id, site_name, site_code),
      ticket:tickets(id, ticket_no, title),
      requester:users!spare_part_requests_requested_by_fkey(id, full_name),
      items:spare_part_request_items(quantity)
    `)
    .order("created_at", { ascending: false });

  const typedRequests = (requests || []) as unknown as PartRequestRow[];

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Part Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Spare part requests linked to support tickets
          </p>
        </div>
        <Link
          href="/admin/part-requests/create"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + New Request
        </Link>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Request #</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Ticket</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Site</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Items</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Status</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Priority</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Cost</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {typedRequests.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-sm text-muted-foreground">
                  No part requests yet.
                </td>
              </tr>
            ) : (
              typedRequests.map((req) => {
                const ticketNo = getTicketNo(req.ticket);
                const statusColor = SPR_STATUS_COLORS[req.status as keyof typeof SPR_STATUS_COLORS] || "bg-gray-100 text-gray-800";
                const statusLabel = SPR_STATUS_LABELS[req.status as keyof typeof SPR_STATUS_LABELS] || req.status;
                const priorityLabel = SPR_PRIORITY_LABELS[req.priority as keyof typeof SPR_PRIORITY_LABELS] || req.priority;

                return (
                  <tr key={req.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3">
                      <Link
                        href={`/admin/part-requests/${req.id}`}
                        className="text-xs font-mono font-medium text-primary hover:text-primary/80"
                      >
                        {req.request_no}
                      </Link>
                    </td>
                    <td className="p-3">
                      {ticketNo ? (
                        <Link
                          href={`/tickets/${ticketNo}`}
                          className="text-xs font-mono text-primary hover:text-primary/80"
                        >
                          {ticketNo}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      <p className="text-sm text-foreground">{getSiteName(req.site)}</p>
                    </td>
                    <td className="p-3">
                      <span className="text-sm text-foreground">
                        {req.items ? req.items.length : 0} items
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="text-xs text-muted-foreground">{priorityLabel}</span>
                    </td>
                    <td className="p-3">
                      <span className="text-sm text-foreground">
                        {req.total_cost ? `$${Number(req.total_cost).toFixed(2)}` : "—"}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="text-xs text-muted-foreground">
                        {new Date(req.created_at).toLocaleDateString()}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
