import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  STATUS_LABELS,
  SEVERITY_LABELS,
  REQUEST_TYPE_LABELS,
  IMPACT_LABELS,
  type TicketStatus,
  type Severity,
} from "@/types/ticket";
import { SPR_STATUS_LABELS, SPR_STATUS_COLORS, FSO_STATUS_LABELS, FSO_STATUS_COLORS, SERVICE_TYPE_LABELS } from "@/types/spare-parts";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { AIAssistButton } from "./ai-assist-button";
import { TicketActionsPanel } from "./ticket-actions-panel";
import { SLABadge } from "./sla-badge";
import { getUserScope, scopeTickets } from "@/lib/supabase/scope";
import { resolveTicketQuery } from "@/lib/tickets/lookup";
import { isAdminRole } from "@/lib/roles";

interface Props {
  params: Promise<{ ticketId: string }>;
}

export default async function TicketDetailPage({ params }: Props) {
  const { ticketId } = await params;
  const supabase = createAdminClient();

  const serverSupabase = await createClient();
  const {
    data: { user: authUser },
  } = await serverSupabase.auth.getUser();

  const scope = await getUserScope();
  const currentUserId = authUser?.id || "";
  const isInternal = scope?.isInternal ?? false;
  const isAdmin = scope ? isAdminRole(scope.role) : false;

  // Fetch ticket by ID or ticket_no, scoped so non-internal users can't see
  // tickets outside their tenant.
  let ticketQuery = supabase
    .from("tickets")
    .select(
      `
      *,
      customer:customers(id, name),
      site:sites(id, site_name, site_code, slack_channel_id, timezone),
      owner:users!tickets_owner_id_fkey(id, full_name, email),
      creator:users!tickets_created_by_fkey(id, full_name, email)
    `
    );
  ticketQuery = resolveTicketQuery(ticketQuery, ticketId);
  if (scope) {
    ticketQuery = scopeTickets(ticketQuery, scope);
  }
  const { data: ticket } = await ticketQuery.maybeSingle();

  if (!ticket) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-xl font-bold text-foreground mb-2">Ticket Not Found</h1>
        <Link href="/tickets" className="text-sm text-primary hover:text-primary/80">
          ← Back to tickets
        </Link>
      </div>
    );
  }

  // Get site timezone for display
  const siteData = Array.isArray(ticket.site) ? ticket.site[0] : ticket.site;
  const userTimezone =
    (siteData as unknown as { timezone?: string } | null)?.timezone ||
    "America/New_York";

  // Comments: non-internal users only see customer-visible comments
  let commentsQuery = supabase
    .from("ticket_comments")
    .select("*, author:users(full_name, role)")
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: true });
  if (!isInternal) {
    commentsQuery = commentsQuery.eq("visibility", "customer");
  }
  const { data: comments } = await commentsQuery;

  // Attachments: same visibility gating
  let attachmentsQuery = supabase
    .from("ticket_attachments")
    .select("*")
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: true });
  if (!isInternal) {
    attachmentsQuery = attachmentsQuery.eq("visibility", "customer");
  }
  const { data: attachments } = await attachmentsQuery;

  // Events: only internal users see the full audit trail. Customers get
  // a high-level "what happened" view built in the UI from the ticket
  // fields directly (no raw event rows).
  const { data: events } = isInternal
    ? await supabase
        .from("ticket_events")
        .select("*, actor:users!ticket_events_actor_id_fkey(full_name, email, role)")
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: true })
    : { data: null };

  // Available owners (for the owner selector — internal users only need this)
  const { data: ownersData } = isInternal
    ? await supabase
        .from("users")
        .select("id, full_name")
        .in("role", ["admin", "engineer"])
        .eq("status", "active")
        .order("full_name")
    : { data: [] };
  const availableOwners = ownersData || [];

  // Fetch AI suggestions — internal-only. The AI panel shows
  // troubleshooting notes, customer-reply drafts, and our
  // mock-fallback text ("Ripple Assist is offline..."), none of
  // which should leak to customer-role viewers.
  const { data: aiSuggestions } = isInternal
    ? await supabase
        .from("ai_suggestions")
        .select("*")
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: false })
    : { data: null };

  // Fetch linked spare part requests
  const { data: partRequests } = await supabase
    .from("spare_part_requests")
    .select("id, request_no, status, priority, total_cost, created_at, items:spare_part_request_items(quantity)")
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: false });

  // Fetch linked field service orders
  const { data: fieldServiceOrders } = await supabase
    .from("field_service_orders")
    .select("id, order_no, title, service_type, status, scheduled_date, estimated_hours, actual_hours, engineers:field_service_engineers(engineer:users(full_name))")
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: false });

  // Format event type labels
  function formatEventType(type: string): string {
    const labels: Record<string, string> = {
      ticket_created: "Ticket created",
      status_changed: "Status changed",
      owner_assigned: "Owner assigned",
      severity_changed: "Severity changed",
      comment_added: "Comment added",
      attachment_added: "Attachment added",
    };
    return labels[type] || type.replace(/_/g, " ");
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link href="/tickets" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to tickets
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-lg font-mono text-muted-foreground">{ticket.ticket_no}</span>
            <span className={`status-${ticket.status} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}>
              {STATUS_LABELS[ticket.status as keyof typeof STATUS_LABELS]}
            </span>
            <span className={`severity-${ticket.severity} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}>
              {ticket.severity}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">{ticket.title}</h1>
        </div>
        <AIAssistButton ticketId={ticket.id} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main content */}
        <div className="lg:col-span-3 space-y-6">
          {/* Description */}
          <div className="rounded-xl border border-border p-6">
            <h2 className="text-sm font-semibold text-foreground mb-3">Description</h2>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{ticket.description}</p>
          </div>

          {/* Resolution Summary */}
          {ticket.customer_visible_summary && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-6">
              <h2 className="text-sm font-semibold text-green-800 mb-3">✅ Customer Visible Summary</h2>
              <p className="text-sm text-green-700 whitespace-pre-wrap">{ticket.customer_visible_summary}</p>
            </div>
          )}

          {/* Internal Summary */}
          {ticket.internal_summary && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
              <h2 className="text-sm font-semibold text-amber-800 mb-3">🔒 Internal Summary</h2>
              <p className="text-sm text-amber-700 whitespace-pre-wrap">{ticket.internal_summary}</p>
            </div>
          )}

          {/* Comments */}
          <div className="rounded-xl border border-border p-6">
            <h2 className="text-sm font-semibold text-foreground mb-4">
              Comments ({comments?.length || 0})
            </h2>
            {(!comments || comments.length === 0) ? (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            ) : (
              <div className="space-y-4">
                {comments.map((comment: { id: string; body: string; visibility: string; source: string; created_at: string; author: { full_name: string; role: string }[] }) => (
                  <div
                    key={comment.id}
                    className={`border-l-2 pl-4 ${
                      comment.visibility === "internal" ? "border-amber-400 bg-amber-50/50" : "border-primary/30"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-foreground">
                        {comment.author?.[0]?.full_name || "Unknown"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        via {comment.source}
                      </span>
                      {comment.visibility === "internal" && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                          Internal
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatDate(comment.created_at, userTimezone)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{comment.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Attachments */}
          {attachments && attachments.length > 0 && (
            <div className="rounded-xl border border-border p-6">
              <h2 className="text-sm font-semibold text-foreground mb-4">
                Attachments ({attachments.length})
              </h2>
              <div className="space-y-2">
                {attachments.map((att: { id: string; file_name: string; file_type: string; file_size: number; visibility: string }) => (
                  <div key={att.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{att.file_name}</p>
                      <p className="text-xs text-muted-foreground">{(att.file_size / 1024).toFixed(1)} KB</p>
                    </div>
                    {att.visibility === "internal" && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Internal</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Suggestions */}
          {aiSuggestions && aiSuggestions.length > 0 && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-6">
              <h2 className="text-sm font-semibold text-blue-800 mb-4">
                🤖 Ripple Assist Suggestions ({aiSuggestions.length})
              </h2>
              <div className="space-y-4">
                {aiSuggestions.map((sug: { id: string; suggestion_type: string; output_text: string; confidence_level: string; model_name: string; created_at: string }) => (
                  <div key={sug.id} className="border border-blue-200 rounded-lg p-4 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-medium text-blue-700">{sug.suggestion_type}</span>
                      <span className="text-xs text-muted-foreground">via {sug.model_name}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(sug.created_at, userTimezone)}</span>
                      {sug.confidence_level && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          sug.confidence_level === "high" ? "bg-green-100 text-green-700" :
                          sug.confidence_level === "low" ? "bg-red-100 text-red-700" :
                          "bg-yellow-100 text-yellow-700"
                        }`}>
                          {sug.confidence_level}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{sug.output_text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Linked Spare Part Requests */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                📦 Spare Part Requests ({partRequests?.length || 0})
              </h2>
              {isInternal && (
                <Link
                  href={`/admin/part-requests/create?ticket_id=${ticket.id}`}
                  className="text-xs font-medium text-primary hover:text-primary/80"
                >
                  + New Request
                </Link>
              )}
            </div>
            {(!partRequests || partRequests.length === 0) ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                No spare part requests linked to this ticket.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {partRequests.map((req: Record<string, unknown>) => {
                  const statusColor = SPR_STATUS_COLORS[req.status as keyof typeof SPR_STATUS_COLORS] || "bg-gray-100 text-gray-800";
                  const itemCount = Array.isArray(req.items) ? req.items.length : 0;
                  return (
                    <Link
                      key={req.id as string}
                      href={`/admin/part-requests/${req.id as string}`}
                      className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono font-medium text-primary">{req.request_no as string}</span>
                        <span className="text-xs text-muted-foreground">{itemCount} items</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {req.total_cost ? <span className="text-xs text-muted-foreground">${Number(req.total_cost).toFixed(2)}</span> : null}
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                          {SPR_STATUS_LABELS[req.status as keyof typeof SPR_STATUS_LABELS] || req.status as string}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Linked Field Service Orders */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                🔧 Field Service Orders ({fieldServiceOrders?.length || 0})
              </h2>
              {isInternal && (
                <Link
                  href={`/admin/field-service/create?ticket_id=${ticket.id}`}
                  className="text-xs font-medium text-primary hover:text-primary/80"
                >
                  + New Service Order
                </Link>
              )}
            </div>
            {(!fieldServiceOrders || fieldServiceOrders.length === 0) ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                No field service orders linked to this ticket.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {fieldServiceOrders.map((order: Record<string, unknown>) => {
                  const statusColor = FSO_STATUS_COLORS[order.status as keyof typeof FSO_STATUS_COLORS] || "bg-gray-100 text-gray-800";
                  const engineers = (order.engineers as Record<string, unknown>[]) || [];
                  const engineerNames = engineers.map((e) => {
                    const eng = e.engineer as Record<string, unknown> | null;
                    return eng?.full_name as string || "";
                  }).filter(Boolean).join(", ");
                  return (
                    <Link
                      key={order.id as string}
                      href={`/admin/field-service/${order.id as string}`}
                      className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono font-medium text-primary">{order.order_no as string}</span>
                        <span className="text-xs text-foreground">{order.title as string}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {SERVICE_TYPE_LABELS[order.service_type as keyof typeof SERVICE_TYPE_LABELS] || order.service_type as string}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                          {FSO_STATUS_LABELS[order.status as keyof typeof FSO_STATUS_LABELS] || order.status as string}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* SLA — shown for internal users and customer_managers.
              Customers viewing their own tickets can also see it. */}
          <SLABadge
            severity={ticket.severity as Severity}
            status={ticket.status as TicketStatus}
            first_response_due_at={ticket.first_response_due_at as string | null}
            resolve_due_at={ticket.resolve_due_at as string | null}
            first_response_at={ticket.first_response_at as string | null}
            sla_breached={!!ticket.sla_breached}
          />
          <div className="rounded-xl border border-border p-6 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Details</h2>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-muted-foreground">Customer</dt><dd className="font-medium">{ticket.customer?.[0]?.name}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Site</dt><dd className="font-medium">{ticket.site?.[0]?.site_name} ({ticket.site?.[0]?.site_code})</dd></div>
              <div><dt className="text-xs text-muted-foreground">Type</dt><dd className="font-medium">{REQUEST_TYPE_LABELS[ticket.request_type as keyof typeof REQUEST_TYPE_LABELS]}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Severity</dt><dd className="font-medium">{SEVERITY_LABELS[ticket.severity as keyof typeof SEVERITY_LABELS]}</dd></div>
              {ticket.impact && <div><dt className="text-xs text-muted-foreground">Impact</dt><dd className="font-medium">{IMPACT_LABELS[ticket.impact as keyof typeof IMPACT_LABELS]}</dd></div>}
              {ticket.asset_id && <div><dt className="text-xs text-muted-foreground">Asset</dt><dd className="font-medium">{ticket.asset_id}</dd></div>}
              {ticket.area && <div><dt className="text-xs text-muted-foreground">Area</dt><dd className="font-medium">{ticket.area}</dd></div>}
              <div><dt className="text-xs text-muted-foreground">Source</dt><dd className="font-medium">{ticket.source}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Owner</dt><dd className="font-medium">{ticket.owner?.[0]?.full_name || "Unassigned"}</dd></div>
              {ticket.submitter_name && <div><dt className="text-xs text-muted-foreground">Submitter</dt><dd className="font-medium">{ticket.submitter_name} ({ticket.submitter_email})</dd></div>}
              <div>
                <dt className="text-xs text-muted-foreground">Created</dt>
                <dd className="font-medium">{formatDate(ticket.created_at, userTimezone)}</dd>
              </div>
              {ticket.resolved_at && (
                <div>
                  <dt className="text-xs text-muted-foreground">Resolved</dt>
                  <dd className="font-medium">{formatDate(ticket.resolved_at, userTimezone)}</dd>
                </div>
              )}
              {ticket.closed_at && (
                <div>
                  <dt className="text-xs text-muted-foreground">Closed</dt>
                  <dd className="font-medium">{formatDate(ticket.closed_at, userTimezone)}</dd>
                </div>
              )}
            </dl>
            <p className="text-xs text-muted-foreground border-t border-border pt-2 mt-2">
              All times shown in {userTimezone}
            </p>
          </div>

          {/* Activity Timeline */}
          {events && events.length > 0 && (
            <div className="rounded-xl border border-border p-6">
              <h2 className="text-sm font-semibold text-foreground mb-3">Activity</h2>
              <div className="space-y-3">
                {events.map((ev: {
                  id: string;
                  event_type: string;
                  old_value: string | null;
                  new_value: string | null;
                  created_at: string;
                  actor: { full_name: string; email: string; role: string }[] | null;
                }, i: number) => {
                  const actorData = ev.actor
                    ? (Array.isArray(ev.actor) ? ev.actor[0] : ev.actor) as { full_name: string; email: string; role: string } | null
                    : null;

                  return (
                    <div key={ev.id || i} className="flex items-start gap-2">
                      <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                      <div>
                        <p className="text-xs text-foreground">
                          {ev.event_type === "ticket_created" && "Ticket created"}
                          {ev.event_type === "status_changed" && `Status: ${ev.old_value} → ${ev.new_value}`}
                          {ev.event_type === "owner_assigned" && `Owner assigned: ${ev.new_value ? "changed" : "assigned"}`}
                          {ev.event_type === "severity_changed" && `Severity: ${ev.old_value} → ${ev.new_value}`}
                          {ev.event_type === "comment_added" && `Comment added (${ev.new_value})`}
                          {ev.event_type === "attachment_added" && `Attachment: ${ev.new_value}`}
                        </p>
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-muted-foreground">
                            {formatDate(ev.created_at, userTimezone)}
                          </p>
                          {actorData && (
                            <span className="text-xs text-muted-foreground">
                              by {actorData.full_name || actorData.email}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground border-t border-border pt-2 mt-3">
                Times in {userTimezone}
              </p>
            </div>
          )}
          {/* Ticket Actions */}
          <TicketActionsPanel
            ticketId={ticket.id}
            ticketNo={ticket.ticket_no}
            currentStatus={ticket.status as TicketStatus}
            currentSeverity={ticket.severity as Severity}
            currentOwnerId={ticket.owner_id}
            availableOwners={availableOwners}
            currentUserId={currentUserId}
            isInternal={isInternal}
            isAdmin={isAdmin}
            currentCustomerVisibleSummary={ticket.customer_visible_summary}
            currentInternalSummary={ticket.internal_summary}
          />
        </div>
      </div>
    </div>
  );
}
