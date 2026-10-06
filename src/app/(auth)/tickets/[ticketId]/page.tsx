import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TicketStatus, Severity } from "@/types/ticket";
import { SPR_STATUS_COLORS, FSO_STATUS_COLORS } from "@/types/spare-parts";
import { formatDate, formatFileSize, resolveSiteTimezone, singleRelation } from "@/lib/utils";
import { isCustomerReopenable } from "@/lib/tickets/status";
import Link from "next/link";
import { TicketActionsPanel } from "./ticket-actions-panel";
import { SLABadge } from "./sla-badge";
import { getUserScope, scopeTickets } from "@/lib/supabase/scope";
import { resolveTicketQuery } from "@/lib/tickets/lookup";
import { redirect } from "next/navigation";
import {
  EXTERNAL_TICKET_DETAIL_SELECT,
  EXTERNAL_TICKET_DETAIL_PART_REQUEST_SELECT,
  INTERNAL_TICKET_DETAIL_PART_REQUEST_SELECT,
  INTERNAL_TICKET_DETAIL_SELECT,
  TICKET_DETAIL_ATTACHMENT_SELECT,
  TICKET_DETAIL_COMMENT_SELECT,
  TICKET_DETAIL_EVENT_SELECT,
  TICKET_DETAIL_FIELD_SERVICE_SELECT,
} from "@/lib/resource-projections";
import { assertPageQueriesSucceeded } from "@/lib/server-page-query";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}): Promise<Metadata> {
  // Title from the URL alone: no lookup, so nothing about the ticket leaks.
  const { ticketId } = await params;
  if (/^RPL-\d{1,12}$/i.test(ticketId)) return { title: ticketId.toUpperCase() };
  const t = await getTranslations("ticketDetail");
  return { title: t("metaTitle") };
}

interface Props {
  params: Promise<{ ticketId: string }>;
}

interface TicketDetailRow {
  id: string;
  ticket_no: string;
  source: string;
  title: string;
  description: string;
  request_type: string;
  severity: string;
  impact: string | null;
  status: string;
  asset_id: string | null;
  area: string | null;
  owner_id?: string | null;
  submitter_name?: string | null;
  submitter_email?: string | null;
  customer_visible_summary: string | null;
  internal_summary?: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  first_response_due_at: string | null;
  resolve_due_at: string | null;
  first_response_at: string | null;
  first_response_breached_at: string | null;
  resolution_breached_at: string | null;
  // Many-to-one embeds arrive as objects at runtime; accept either shape.
  customer: OneOrMany<{ id: string; name: string }>;
  site: OneOrMany<{
    id: string;
    site_name: string;
    site_code: string;
    timezone: string;
  }>;
  owner: OneOrMany<{ id?: string; full_name: string }>;
}

type OneOrMany<T> = T | T[] | null;

interface TicketPartRequestRow {
  id: string;
  request_no: string;
  status: string;
  total_cost?: number | null;
  items: { quantity: number }[] | null;
}

export default async function TicketDetailPage({ params }: Props) {
  const { ticketId } = await params;
  const supabase = createAdminClient();

  const scope = await getUserScope();
  if (!scope) redirect("/login");
  const [t, labels, locale] = await Promise.all([
    getTranslations("ticketDetail"),
    getTranslations("labels"),
    getLocale(),
  ]);
  const label = (group: string, value: string | null | undefined) =>
    value && labels.has(`${group}.${value}`) ? labels(`${group}.${value}`) : value ?? "";
  const currentUserId = scope.userId;
  const isInternal = scope.isInternal;

  // The service-role client bypasses RLS and column grants. Select a distinct
  // customer allow-list at query time instead of fetching internal fields and
  // relying only on conditional rendering to hide them.
  // Widen the conditional to `string` so Supabase's compile-time select
  // parser does not attempt to materialize the union of two large nested
  // relationship projections. Both concrete values remain tested constants.
  const ticketSelect: string = isInternal
    ? INTERNAL_TICKET_DETAIL_SELECT
    : EXTERNAL_TICKET_DETAIL_SELECT;
  let ticketQuery = supabase
    .from("tickets")
    .select(ticketSelect);
  ticketQuery = resolveTicketQuery(ticketQuery, ticketId);
  ticketQuery = scopeTickets(ticketQuery, scope);
  const ticketResult = await ticketQuery.maybeSingle();
  assertPageQueriesSucceeded("tickets/detail-primary", ticketResult);
  const ticketData = ticketResult.data;
  const ticket = ticketData as unknown as TicketDetailRow | null;

  if (!ticket) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-xl font-bold text-foreground mb-2">{t("notFound")}</h1>
        <Link href="/tickets" className="text-sm text-primary hover:text-primary/80">
          {t("back")}
        </Link>
      </div>
    );
  }

  // Operational timestamps belong to the ticket's site. Missing or invalid
  // legacy timezone values render deterministically in UTC.
  const userTimezone = resolveSiteTimezone(ticket.site);

  // Comments: non-internal users only see customer-visible comments
  let commentsQuery = supabase
    .from("ticket_comments")
    .select(TICKET_DETAIL_COMMENT_SELECT)
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: true });
  if (!isInternal) {
    commentsQuery = commentsQuery.eq("visibility", "customer");
  }
  // Attachments: same visibility gating
  let attachmentsQuery = supabase
    .from("ticket_attachments")
    .select(TICKET_DETAIL_ATTACHMENT_SELECT)
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: true });
  if (!isInternal) {
    attachmentsQuery = attachmentsQuery.eq("visibility", "customer");
  }
  // Events: only internal users see the full audit trail. Customers get
  // a high-level "what happened" view built in the UI from the ticket
  // fields directly (no raw event rows).
  const eventsPromise = isInternal
    ? supabase
        .from("ticket_events")
        .select(TICKET_DETAIL_EVENT_SELECT)
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: true })
    : Promise.resolve({ data: null, error: null });

  // Available owners (for the owner selector — internal users only need this)
  const ownersPromise = isInternal
    ? supabase
        .from("users")
        .select("id, full_name")
        .in("role", ["admin", "engineer"])
        .eq("status", "active")
        .order("full_name")
    : Promise.resolve({ data: [], error: null });

  // Fetch linked spare part requests
  const partRequestSelect: string = isInternal
    ? INTERNAL_TICKET_DETAIL_PART_REQUEST_SELECT
    : EXTERNAL_TICKET_DETAIL_PART_REQUEST_SELECT;
  const partRequestsPromise = supabase
    .from("spare_part_requests")
    .select(partRequestSelect)
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: false });

  // Fetch linked field service orders
  const fieldServiceOrdersPromise = supabase
    .from("field_service_orders")
    .select(TICKET_DETAIL_FIELD_SERVICE_SELECT)
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: false });

  const [
    commentsResult,
    attachmentsResult,
    eventsResult,
    ownersResult,
    partRequestsResult,
    fieldServiceOrdersResult,
  ] = await Promise.all([
    commentsQuery,
    attachmentsQuery,
    eventsPromise,
    ownersPromise,
    partRequestsPromise,
    fieldServiceOrdersPromise,
  ]);
  assertPageQueriesSucceeded(
    "tickets/detail-related",
    commentsResult,
    attachmentsResult,
    eventsResult,
    ownersResult,
    partRequestsResult,
    fieldServiceOrdersResult
  );
  const comments = commentsResult.data;
  const attachments = attachmentsResult.data;
  const events = eventsResult.data;
  const availableOwners = ownersResult.data || [];
  const partRequests = partRequestsResult.data as unknown as
    | TicketPartRequestRow[]
    | null;
  const fieldServiceOrders = fieldServiceOrdersResult.data;

  const when = (value: string) => formatDate(value, userTimezone, locale);

  return (
    <div className="min-w-0 p-4 sm:p-8">
      <div className="mb-6">
        <Link href="/tickets" className="text-sm text-muted-foreground hover:text-foreground">
          {t("back")}
        </Link>
      </div>

      {/* Header */}
      <div className="mb-8 flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <span className="text-lg font-mono text-muted-foreground">{ticket.ticket_no}</span>
            <span className={`status-${ticket.status} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}>
              {label("status", ticket.status)}
            </span>
            <span className={`severity-${ticket.severity} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}>
              {ticket.severity}
            </span>
          </div>
          <h1 className="break-words text-2xl font-bold text-foreground">{ticket.title}</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 xl:col-span-2">
          {/* Description */}
          <div className="rounded-xl border border-border p-6">
            <h2 className="text-sm font-semibold text-foreground mb-3">{t("description")}</h2>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{ticket.description}</p>
          </div>

          {/* Resolution Summary */}
          {ticket.customer_visible_summary && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-6">
              <h2 className="text-sm font-semibold text-green-800 mb-3">✅ {t("resolutionSummary")}</h2>
              <p className="text-sm text-green-700 whitespace-pre-wrap">{ticket.customer_visible_summary}</p>
            </div>
          )}

          {/* Internal Summary */}
          {isInternal && ticket.internal_summary && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
              <h2 className="text-sm font-semibold text-amber-800 mb-3">🔒 {t("internalSummary")}</h2>
              <p className="text-sm text-amber-700 whitespace-pre-wrap">{ticket.internal_summary}</p>
            </div>
          )}

          {/* Comments */}
          <div className="rounded-xl border border-border p-6">
            <h2 className="text-sm font-semibold text-foreground mb-4">
              {t("comments", { count: comments?.length || 0 })}
            </h2>
            {(!comments || comments.length === 0) ? (
              <p className="text-sm text-muted-foreground">{t("noComments")}</p>
            ) : (
              <div className="space-y-4">
                {comments.map((comment: { id: string; body: string; visibility: string; source: string; created_at: string; author: { full_name: string } | { full_name: string }[] | null }) => (
                  <div
                    key={comment.id}
                    className={`border-l-2 pl-4 ${
                      comment.visibility === "internal" ? "border-amber-400 bg-amber-50/50" : "border-primary/30"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1">
                      <span className="text-xs font-medium text-foreground">
                        {singleRelation(comment.author)?.full_name ?? t("submitter")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("via", { source: label("source", comment.source) })}
                      </span>
                      {comment.visibility === "internal" && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                          {t("internal")}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {when(comment.created_at)}
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
                {t("attachments", { count: attachments.length })}
              </h2>
              <div className="space-y-2">
                {attachments.map((att: { id: string; file_name: string; file_type: string; file_size: number; visibility: string }) => (
                  <div key={att.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    <div className="min-w-0 flex-1">
                      {/* Route handler redirect, not a page: plain anchor is intended. */}
                      <a
                        href={`/api/attachments/${att.id}`}
                        className="block break-all text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {att.file_name}
                        <span className="sr-only"> {t("download")}</span>
                      </a>
                      <p className="text-xs text-muted-foreground">{formatFileSize(att.file_size)}</p>
                    </div>
                    {att.visibility === "internal" && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">{t("internal")}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Linked Spare Part Requests */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                📦 {t("partRequests", { count: partRequests?.length || 0 })}
              </h2>
              {isInternal && (
                <Link
                  href={`/part-requests/create?ticket_id=${ticket.id}`}
                  className="text-xs font-medium text-primary hover:text-primary/80"
                >
                  {t("newPartRequest")}
                </Link>
              )}
            </div>
            {(!partRequests || partRequests.length === 0) ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                {t("noPartRequests")}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {partRequests.map((req) => {
                  const statusColor = SPR_STATUS_COLORS[req.status as keyof typeof SPR_STATUS_COLORS] || "bg-gray-100 text-gray-800";
                  const itemCount = Array.isArray(req.items) ? req.items.length : 0;
                  const content = (
                    <>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono font-medium text-primary">{req.request_no}</span>
                        <span className="text-xs text-muted-foreground">{t("items", { count: itemCount })}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {isInternal && req.total_cost ? <span className="text-xs text-muted-foreground">${Number(req.total_cost).toFixed(2)}</span> : null}
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                          {label("partRequestStatus", req.status)}
                        </span>
                      </div>
                    </>
                  );
                  return isInternal ? (
                    <Link
                      key={req.id}
                      href={`/part-requests/${req.id}`}
                      className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div
                      key={req.id}
                      className="flex items-center justify-between p-3"
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Linked Field Service Orders */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                🔧 {t("fieldService", { count: fieldServiceOrders?.length || 0 })}
              </h2>
              {isInternal && (
                <Link
                  href={`/field-service/create?ticket_id=${ticket.id}`}
                  className="text-xs font-medium text-primary hover:text-primary/80"
                >
                  {t("newFieldService")}
                </Link>
              )}
            </div>
            {(!fieldServiceOrders || fieldServiceOrders.length === 0) ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                {t("noFieldService")}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {fieldServiceOrders.map((order: Record<string, unknown>) => {
                  const statusColor = FSO_STATUS_COLORS[order.status as keyof typeof FSO_STATUS_COLORS] || "bg-gray-100 text-gray-800";
                  const content = (
                    <>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono font-medium text-primary">{order.order_no as string}</span>
                        <span className="text-xs text-foreground">{order.title as string}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {label("serviceType", order.service_type as string)}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                          {label("fieldServiceStatus", order.status as string)}
                        </span>
                      </div>
                    </>
                  );
                  return isInternal ? (
                    <Link
                      key={order.id as string}
                      href={`/field-service/${order.id as string}`}
                      className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div
                      key={order.id as string}
                      className="flex items-center justify-between p-3"
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* SLA — shown for everyone. Customers can see their own
              ticket's status, internal users see the breach alarm. */}
          <SLABadge
            severity={ticket.severity as Severity}
            status={ticket.status as TicketStatus}
            first_response_due_at={ticket.first_response_due_at as string | null}
            resolve_due_at={ticket.resolve_due_at as string | null}
            first_response_at={ticket.first_response_at as string | null}
            resolved_at={ticket.resolved_at as string | null}
            first_response_breached_at={ticket.first_response_breached_at as string | null}
            resolution_breached_at={ticket.resolution_breached_at as string | null}
            timezone={userTimezone}
          />
          <div className="rounded-xl border border-border p-6 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">{t("details")}</h2>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-muted-foreground">{t("customer")}</dt><dd className="font-medium">{singleRelation(ticket.customer)?.name}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("site")}</dt><dd className="font-medium">{singleRelation(ticket.site)?.site_name} ({singleRelation(ticket.site)?.site_code})</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("type")}</dt><dd className="font-medium">{label("requestType", ticket.request_type)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("severity")}</dt><dd className="font-medium">{label("severity", ticket.severity)}</dd></div>
              {ticket.impact && <div><dt className="text-xs text-muted-foreground">{t("impact")}</dt><dd className="font-medium">{label("impact", ticket.impact)}</dd></div>}
              {ticket.asset_id && <div><dt className="text-xs text-muted-foreground">{t("asset")}</dt><dd className="font-medium">{ticket.asset_id}</dd></div>}
              {ticket.area && <div><dt className="text-xs text-muted-foreground">{t("area")}</dt><dd className="font-medium">{ticket.area}</dd></div>}
              <div><dt className="text-xs text-muted-foreground">{t("source")}</dt><dd className="font-medium">{label("source", ticket.source)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("owner")}</dt><dd className="font-medium">{singleRelation(ticket.owner)?.full_name || t("unassigned")}</dd></div>
              {isInternal && ticket.submitter_name && <div><dt className="text-xs text-muted-foreground">{t("submitterLabel")}</dt><dd className="font-medium">{ticket.submitter_name} ({ticket.submitter_email})</dd></div>}
              <div>
                <dt className="text-xs text-muted-foreground">{t("created")}</dt>
                <dd className="font-medium">{when(ticket.created_at)}</dd>
              </div>
              {ticket.resolved_at && (
                <div>
                  <dt className="text-xs text-muted-foreground">{t("resolved")}</dt>
                  <dd className="font-medium">{when(ticket.resolved_at)}</dd>
                </div>
              )}
              {ticket.closed_at && (
                <div>
                  <dt className="text-xs text-muted-foreground">{t("closed")}</dt>
                  <dd className="font-medium">{when(ticket.closed_at)}</dd>
                </div>
              )}
            </dl>
            <p className="text-xs text-muted-foreground border-t border-border pt-2 mt-2">
              {t("timesShownIn", { timezone: userTimezone })}
            </p>
          </div>

          {/* Activity Timeline */}
          {events && events.length > 0 && (
            <div className="rounded-xl border border-border p-6">
              <h2 className="text-sm font-semibold text-foreground mb-3">{t("activity")}</h2>
              <div className="space-y-3">
                {events.map((ev: {
                  id: string;
                  event_type: string;
                  old_value: string | null;
                  new_value: string | null;
                  created_at: string;
                  actor: { full_name: string; email: string }[] | null;
                }, i: number) => {
                  const actorData = ev.actor
                    ? (Array.isArray(ev.actor) ? ev.actor[0] : ev.actor) as { full_name: string; email: string } | null
                    : null;

                  return (
                    <div key={ev.id || i} className="flex items-start gap-2">
                      <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                      <div>
                        <p className="text-xs text-foreground">
                          {ev.event_type === "ticket_created" && t("events.ticket_created")}
                          {ev.event_type === "status_changed" &&
                            t("events.status_changed", {
                              from: label("status", ev.old_value),
                              to: label("status", ev.new_value),
                            })}
                          {ev.event_type === "owner_assigned" && t("events.owner_assigned")}
                          {ev.event_type === "severity_changed" &&
                            t("events.severity_changed", {
                              from: ev.old_value ?? "",
                              to: ev.new_value ?? "",
                            })}
                          {ev.event_type === "comment_added" &&
                            t("events.comment_added", { visibility: ev.new_value ?? "" })}
                          {ev.event_type === "attachment_added" &&
                            t("events.attachment_added", { name: ev.new_value ?? "" })}
                        </p>
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-muted-foreground">
                            {when(ev.created_at)}
                          </p>
                          {actorData && (
                            <span className="text-xs text-muted-foreground">
                              {t("by", { name: actorData.full_name || actorData.email })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground border-t border-border pt-2 mt-3">
                {t("timesIn", { timezone: userTimezone })}
              </p>
            </div>
          )}
          {/* Ticket Actions */}
          <TicketActionsPanel
            ticketId={ticket.id}
            ticketNo={ticket.ticket_no}
            currentStatus={ticket.status as TicketStatus}
            currentSeverity={ticket.severity as Severity}
            currentOwnerId={isInternal ? ticket.owner_id ?? null : null}
            availableOwners={availableOwners}
            currentUserId={isInternal ? currentUserId : ""}
            isInternal={isInternal}
            currentCustomerVisibleSummary={ticket.customer_visible_summary}
            currentInternalSummary={
              isInternal ? ticket.internal_summary ?? null : null
            }
            canCustomerReopen={
              !isInternal && isCustomerReopenable(ticket.status, ticket.closed_at)
            }
          />
        </div>
      </div>
    </div>
  );
}
