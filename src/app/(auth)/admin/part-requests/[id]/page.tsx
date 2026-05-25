import { createAdminClient } from "@/lib/supabase/admin";
import { SPR_STATUS_LABELS, SPR_STATUS_COLORS, SPR_PRIORITY_LABELS } from "@/types/spare-parts";
import Link from "next/link";
import { PartRequestActions } from "./part-request-actions";

export const dynamic = "force-dynamic";

interface SPRItem {
  id: string;
  quantity: number;
  fulfilled_quantity: number;
  unit_price: number | null;
  notes: string | null;
  spare_part: { part_name: string; part_number: string } | null;
}

interface SPRDetail {
  id: string;
  request_no: string;
  status: string;
  priority: string;
  notes: string | null;
  total_cost: number | null;
  created_at: string;
  shipped_at: string | null;
  delivered_at: string | null;
  shipping_carrier: string | null;
  shipping_tracking: string | null;
  site: { site_name: string } | { site_name: string }[] | null;
  ticket: { ticket_no: string } | { ticket_no: string }[] | null;
  requester: { full_name: string } | { full_name: string }[] | null;
  approver: { full_name: string } | { full_name: string }[] | null;
  items: SPRItem[];
}

function getField<T>(val: T | T[] | null): T | null {
  if (!val) return null;
  return Array.isArray(val) ? val[0] : val;
}

export default async function PartRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: request } = await supabase
    .from("spare_part_requests")
    .select(`
      *,
      site:sites(site_name),
      ticket:tickets(ticket_no),
      requester:users!spare_part_requests_requested_by_fkey(full_name),
      approver:users!spare_part_requests_approved_by_fkey(full_name),
      items:spare_part_request_items(*, spare_part:spare_parts(part_name, part_number))
    `)
    .eq("id", id)
    .single();

  if (!request) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Part request not found.</p>
        <Link href="/admin/part-requests" className="text-primary mt-2 inline-block">Back to Requests</Link>
      </div>
    );
  }

  const req = request as unknown as SPRDetail;
  const site = getField(req.site);
  const ticket = getField(req.ticket);
  const requester = getField(req.requester);
  const approver = getField(req.approver);
  const statusColor = SPR_STATUS_COLORS[req.status as keyof typeof SPR_STATUS_COLORS] || "bg-gray-100 text-gray-800";

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <Link href="/admin/part-requests" className="hover:text-foreground">Part Requests</Link>
          <span>/</span>
          <span className="text-foreground">{req.request_no}</span>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Part Request {req.request_no}</h1>
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${statusColor}`}>
            {SPR_STATUS_LABELS[req.status as keyof typeof SPR_STATUS_LABELS] || req.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Items Table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-base font-semibold text-foreground">Items</h2>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">Part</th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">Part Number</th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">Qty</th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">Fulfilled</th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">Unit Price</th>
                  <th className="text-left text-xs font-medium text-muted-foreground p-3">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {req.items.map((item) => (
                  <tr key={item.id}>
                    <td className="p-3 text-sm text-foreground">{item.spare_part?.part_name || "—"}</td>
                    <td className="p-3 text-xs font-mono text-muted-foreground">{item.spare_part?.part_number || "—"}</td>
                    <td className="p-3 text-sm text-foreground">{item.quantity}</td>
                    <td className="p-3 text-sm text-foreground">{item.fulfilled_quantity}</td>
                    <td className="p-3 text-sm text-foreground">
                      {item.unit_price ? `$${item.unit_price.toFixed(2)}` : "—"}
                    </td>
                    <td className="p-3 text-sm text-foreground">
                      {item.unit_price ? `$${(item.unit_price * item.quantity).toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Notes */}
          {req.notes ? (
            <div className="rounded-xl border border-border p-6">
              <h2 className="text-base font-semibold text-foreground mb-3">Notes</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{req.notes}</p>
            </div>
          ) : null}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="rounded-xl border border-border p-6 space-y-3">
            <h2 className="text-base font-semibold text-foreground mb-4">Details</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Priority</dt>
                <dd className="text-foreground font-medium">
                  {SPR_PRIORITY_LABELS[req.priority as keyof typeof SPR_PRIORITY_LABELS] || req.priority}
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
                <dt className="text-muted-foreground">Requested By</dt>
                <dd className="text-foreground">{requester?.full_name || "—"}</dd>
              </div>
              {approver && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Approved By</dt>
                  <dd className="text-foreground">{approver.full_name}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Total Cost</dt>
                <dd className="text-foreground font-medium">
                  {req.total_cost ? `$${req.total_cost.toFixed(2)}` : "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Created</dt>
                <dd className="text-foreground">{new Date(req.created_at).toLocaleDateString()}</dd>
              </div>
            </dl>
          </div>

          {/* Shipping */}
          <div className="rounded-xl border border-border p-6 space-y-3">
            <h2 className="text-base font-semibold text-foreground mb-4">Shipping</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Carrier</dt>
                <dd className="text-foreground">{req.shipping_carrier || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tracking</dt>
                <dd className="text-foreground">{req.shipping_tracking || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Shipped</dt>
                <dd className="text-foreground">{req.shipped_at ? new Date(req.shipped_at).toLocaleDateString() : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Delivered</dt>
                <dd className="text-foreground">{req.delivered_at ? new Date(req.delivered_at).toLocaleDateString() : "—"}</dd>
              </div>
            </dl>
          </div>

          <PartRequestActions requestId={id} status={req.status} />
        </div>
      </div>
    </div>
  );
}
