import { createAdminClient } from "@/lib/supabase/admin";
import { FSO_STATUS_LABELS, FSO_STATUS_COLORS, SERVICE_TYPE_LABELS, FSO_PRIORITY_LABELS } from "@/types/spare-parts";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface FieldServiceRow {
  id: string;
  order_no: string;
  title: string;
  service_type: string;
  status: string;
  priority: string;
  scheduled_date: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  created_at: string;
  site: { id: string; site_name: string; site_code: string }[] | { id: string; site_name: string; site_code: string } | null;
  ticket: { id: string; ticket_no: string; title: string }[] | { id: string; ticket_no: string; title: string } | null;
  engineers: { engineer_id: string; role: string; engineer: { id: string; full_name: string }[] | { id: string; full_name: string } }[];
}

function getSiteName(site: FieldServiceRow["site"]): string {
  if (!site) return "—";
  const s = Array.isArray(site) ? site[0] : site;
  return s?.site_name || "—";
}

function getTicketNo(ticket: FieldServiceRow["ticket"]): string | null {
  if (!ticket) return null;
  const t = Array.isArray(ticket) ? ticket[0] : ticket;
  return t?.ticket_no || null;
}

function getEngineerNames(engineers: FieldServiceRow["engineers"]): string {
  if (!engineers || engineers.length === 0) return "—";
  return engineers.map((e) => {
    const eng = Array.isArray(e.engineer) ? e.engineer[0] : e.engineer;
    return eng?.full_name || "Unknown";
  }).join(", ");
}

export default async function FieldServicePage() {
  const supabase = createAdminClient();

  const { data: orders } = await supabase
    .from("field_service_orders")
    .select(`
      id, order_no, title, service_type, status, priority,
      scheduled_date, estimated_hours, actual_hours, created_at,
      site:sites(id, site_name, site_code),
      ticket:tickets(id, ticket_no, title),
      engineers:field_service_engineers(engineer_id, role, engineer:users(id, full_name))
    `)
    .order("created_at", { ascending: false });

  const typedOrders = (orders || []) as unknown as FieldServiceRow[];

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Field Service</h1>
          <p className="text-sm text-muted-foreground mt-1">
            On-site service dispatch and scheduling
          </p>
        </div>
        <Link
          href="/admin/field-service/create"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + New Service Order
        </Link>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Order #</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Title</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Type</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Site</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Engineers</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Status</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Scheduled</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {typedOrders.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-sm text-muted-foreground">
                  No field service orders yet.
                </td>
              </tr>
            ) : (
              typedOrders.map((order) => {
                const ticketNo = getTicketNo(order.ticket);
                const statusColor = FSO_STATUS_COLORS[order.status as keyof typeof FSO_STATUS_COLORS] || "bg-gray-100 text-gray-800";
                const statusLabel = FSO_STATUS_LABELS[order.status as keyof typeof FSO_STATUS_LABELS] || order.status;
                const typeLabel = SERVICE_TYPE_LABELS[order.service_type as keyof typeof SERVICE_TYPE_LABELS] || order.service_type;

                return (
                  <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3">
                      <Link
                        href={`/admin/field-service/${order.id}`}
                        className="text-xs font-mono font-medium text-primary hover:text-primary/80"
                      >
                        {order.order_no}
                      </Link>
                      {ticketNo && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Ticket: <Link href={`/tickets/${ticketNo}`} className="text-primary">{ticketNo}</Link>
                        </p>
                      )}
                    </td>
                    <td className="p-3">
                      <p className="text-sm text-foreground max-w-xs truncate">{order.title}</p>
                    </td>
                    <td className="p-3">
                      <span className="text-xs text-muted-foreground">{typeLabel}</span>
                    </td>
                    <td className="p-3">
                      <p className="text-sm text-foreground">{getSiteName(order.site)}</p>
                    </td>
                    <td className="p-3">
                      <p className="text-xs text-foreground max-w-[150px] truncate">{getEngineerNames(order.engineers)}</p>
                    </td>
                    <td className="p-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="text-xs text-muted-foreground">
                        {order.scheduled_date ? new Date(order.scheduled_date).toLocaleDateString() : "—"}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="text-xs text-muted-foreground">
                        {order.actual_hours ? `${order.actual_hours}h` : order.estimated_hours ? `~${order.estimated_hours}h` : "—"}
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
