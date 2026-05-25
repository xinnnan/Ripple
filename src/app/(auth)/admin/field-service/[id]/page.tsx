import { createAdminClient } from "@/lib/supabase/admin";
import { FSO_STATUS_LABELS, FSO_STATUS_COLORS, SERVICE_TYPE_LABELS, FSO_PRIORITY_LABELS } from "@/types/spare-parts";
import Link from "next/link";
import { FieldServiceActions } from "./field-service-actions";

export const dynamic = "force-dynamic";

interface FSODetail {
  id: string;
  order_no: string;
  title: string;
  service_type: string;
  status: string;
  priority: string;
  description: string | null;
  scheduled_date: string | null;
  scheduled_end_date: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  travel_required: boolean;
  travel_from: string | null;
  completion_report: string | null;
  completion_notes: string | null;
  created_at: string;
  site: { site_name: string } | { site_name: string }[] | null;
  ticket: { ticket_no: string } | { ticket_no: string }[] | null;
  requester: { full_name: string } | { full_name: string }[] | null;
  completer: { full_name: string } | { full_name: string }[] | null;
  engineers: { role: string; engineer: { full_name: string } | { full_name: string }[] }[];
}

function getField<T>(val: T | T[] | null): T | null {
  if (!val) return null;
  return Array.isArray(val) ? val[0] : val;
}

export default async function FieldServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: order } = await supabase
    .from("field_service_orders")
    .select(`
      *,
      site:sites(site_name),
      ticket:tickets(ticket_no),
      requester:users!field_service_orders_requested_by_fkey(full_name),
      completer:users!field_service_orders_completed_by_fkey(full_name),
      engineers:field_service_engineers(role, engineer:users(full_name))
    `)
    .eq("id", id)
    .single();

  if (!order) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Field service order not found.</p>
        <Link href="/admin/field-service" className="text-primary mt-2 inline-block">Back to Field Service</Link>
      </div>
    );
  }

  const o = order as unknown as FSODetail;
  const site = getField(o.site);
  const ticket = getField(o.ticket);
  const requester = getField(o.requester);
  const completer = getField(o.completer);
  const statusColor = FSO_STATUS_COLORS[o.status as keyof typeof FSO_STATUS_COLORS] || "bg-gray-100 text-gray-800";

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <Link href="/admin/field-service" className="hover:text-foreground">Field Service</Link>
          <span>/</span>
          <span className="text-foreground">{o.order_no}</span>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">{o.title}</h1>
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${statusColor}`}>
            {FSO_STATUS_LABELS[o.status as keyof typeof FSO_STATUS_LABELS] || o.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          {o.description ? (
            <div className="rounded-xl border border-border p-6">
              <h2 className="text-base font-semibold text-foreground mb-3">Description</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{o.description}</p>
            </div>
          ) : null}

          {/* Engineers */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-base font-semibold text-foreground">Assigned Engineers</h2>
            </div>
            {o.engineers.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No engineers assigned yet.
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left text-xs font-medium text-muted-foreground p-3">Name</th>
                    <th className="text-left text-xs font-medium text-muted-foreground p-3">Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {o.engineers.map((eng, i) => {
                    const engData = getField(eng.engineer);
                    return (
                      <tr key={i}>
                        <td className="p-3 text-sm text-foreground">{engData?.full_name || "—"}</td>
                        <td className="p-3 text-sm text-muted-foreground capitalize">{eng.role}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Completion Report */}
          {o.completion_report ? (
            <div className="rounded-xl border border-border p-6">
              <h2 className="text-base font-semibold text-foreground mb-3">Completion Report</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{o.completion_report}</p>
            </div>
          ) : null}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="rounded-xl border border-border p-6 space-y-3">
            <h2 className="text-base font-semibold text-foreground mb-4">Details</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Type</dt>
                <dd className="text-foreground font-medium">
                  {SERVICE_TYPE_LABELS[o.service_type as keyof typeof SERVICE_TYPE_LABELS] || o.service_type}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Priority</dt>
                <dd className="text-foreground">
                  {FSO_PRIORITY_LABELS[o.priority as keyof typeof FSO_PRIORITY_LABELS] || o.priority}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Site</dt>
                <dd className="text-foreground">{site?.site_name || "—"}</dd>
              </div>
              {ticket && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Ticket</dt>
                  <dd>
                    <Link href={`/tickets/${ticket.ticket_no}`} className="text-primary hover:text-primary/80">
                      {ticket.ticket_no}
                    </Link>
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Scheduled</dt>
                <dd className="text-foreground">
                  {o.scheduled_date ? new Date(o.scheduled_date).toLocaleDateString() : "—"}
                  {o.scheduled_end_date ? ` → ${new Date(o.scheduled_end_date).toLocaleDateString()}` : ""}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Est. Hours</dt>
                <dd className="text-foreground">{o.estimated_hours ? `${o.estimated_hours}h` : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Actual Hours</dt>
                <dd className="text-foreground">{o.actual_hours ? `${o.actual_hours}h` : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Travel Required</dt>
                <dd className="text-foreground">{o.travel_required ? "Yes" : "No"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Requested By</dt>
                <dd className="text-foreground">{requester?.full_name || "—"}</dd>
              </div>
              {completer && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Completed By</dt>
                  <dd className="text-foreground">{completer.full_name}</dd>
                </div>
              )}
            </dl>
          </div>

          <FieldServiceActions orderId={id} status={o.status} />
        </div>
      </div>
    </div>
  );
}
