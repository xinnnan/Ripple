import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { formatDate, formatFileSize, resolveSiteTimezone } from "@/lib/utils";
import { consumePublicTicketLimit } from "@/lib/tickets/public-access";
import { isCustomerReopenable } from "@/lib/tickets/status";
import Image from "next/image";
import Link from "next/link";
import { GuestReplyForm } from "./guest-reply-form";
import { LanguageSwitcher } from "@/components/language-switcher";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("share");
  return { title: t("metaTitle") };
}

interface Props {
  params: Promise<{ ticketId: string }>;
  searchParams: Promise<{ token?: string }>;
}

const PUBLIC_EVENT_TYPES = [
  "ticket_created",
  "status_changed",
  "owner_assigned",
] as const;

function PublicTicketMessage({
  title,
  message,
  homeLabel,
}: {
  title: string;
  message: string;
  /** Translated "Go to Home" label; omit to hide the link. */
  homeLabel?: string;
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <h1 className="text-xl font-bold text-foreground mb-2">{title}</h1>
        <p className="text-muted-foreground">{message}</p>
        {homeLabel && (
          <Link
            href="/"
            className="mt-4 inline-block text-sm font-medium text-primary hover:text-primary/80"
          >
            {homeLabel}
          </Link>
        )}
      </div>
    </div>
  );
}

interface PublicComment {
  id: string;
  body: string;
  created_at: string;
  author:
    | { full_name: string; role: string }
    | { full_name: string; role: string }[]
    | null;
}

function singleRelation<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

export default async function TicketViewPage({ params, searchParams }: Props) {
  const { ticketId } = await params;
  const { token } = await searchParams;
  const [t, labels, locale] = await Promise.all([
    getTranslations("share"),
    getTranslations("labels"),
    getLocale(),
  ]);
  const label = (group: string, value: string | null | undefined) =>
    value && labels.has(`${group}.${value}`) ? labels(`${group}.${value}`) : value ?? "";

  // Rate limit: this page is unauthed and gated by a 32-byte
  // secure_token. The token is unguessable in practice, but a
  // determined attacker could still hammer the page with random
  // tokens to probe the system or to extract timing info. Cap
  // unauthed lookups at 30/min/IP. The local guard sheds load quickly;
  // migration 046's command keeps the boundary effective across serverless
  // instances and cold starts. The token still remains the authorization
  // proof for the ticket itself.
  if (!token) {
    return (
      <PublicTicketMessage
        title={t("accessDenied")}
        message={t("tokenRequired")}
        homeLabel={t("goHome")}
      />
    );
  }

  // The token is the authorization proof; the shared limiter (process-local
  // shedding plus migration 046's distributed bucket) caps probing at
  // 30/min/IP across serverless instances and fails closed.
  const ip = getClientIp(await headers());
  const supabase = createAdminClient();
  try {
    const limit = await consumePublicTicketLimit({
      supabase,
      purpose: "ticket-view",
      clientIp: ip,
    });
    if (!limit.allowed) {
      return (
        <PublicTicketMessage
          title={t("tooManyRequests")}
          message={t("rateLimited", { seconds: limit.retryAfterSeconds })}
        />
      );
    }
  } catch (error) {
    console.error("Public ticket rate limit unavailable:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return (
      <PublicTicketMessage
        title={t("unavailableTitle")}
        message={t("unavailable")}
        homeLabel={t("goHome")}
      />
    );
  }

  // Fetch ticket by ID and secure token
  const { data: ticket, error } = await supabase
    .from("tickets")
    .select(
      `
      id,
      ticket_no,
      title,
      description,
      status,
      severity,
      impact,
      asset_id,
      area,
      customer_visible_summary,
      created_at,
      resolved_at,
      closed_at,
      customer:customers!inner(name),
      site:sites!inner(site_name, timezone),
      owner:users!tickets_owner_id_fkey(full_name)
    `
    )
    .eq("ticket_no", ticketId)
    .eq("secure_token", token)
    .eq("site.status", "active")
    .in("customer.status", ["active", "trial"])
    .maybeSingle();

  if (error) {
    console.error("Public ticket lookup failed:", { code: error.code });
    return (
      <PublicTicketMessage
        title={t("unavailableTitle")}
        message={t("unavailable")}
        homeLabel={t("goHome")}
      />
    );
  }
  if (!ticket) {
    return (
      <PublicTicketMessage
        title={t("notFoundTitle")}
        message={t("notFound")}
        homeLabel={t("goHome")}
      />
    );
  }
  const customer = singleRelation(ticket.customer);
  const site = singleRelation(ticket.site);
  const owner = singleRelation(ticket.owner);
  const timezone = resolveSiteTimezone(ticket.site);
  const when = (value: string) => formatDate(value, timezone, locale);
  const canReopen = isCustomerReopenable(ticket.status, ticket.closed_at);
  const acceptsReplies = ticket.status !== "closed" || canReopen;

  const [commentsResult, attachmentsResult, eventsResult] = await Promise.all([
    supabase
      .from("ticket_comments")
      .select("id, body, created_at, author:users(full_name, role)")
      .eq("ticket_id", ticket.id)
      .eq("visibility", "customer")
      .order("created_at", { ascending: true }),
    supabase
      .from("ticket_attachments")
      .select("id, file_name, file_type, file_size, created_at")
      .eq("ticket_id", ticket.id)
      .eq("visibility", "customer")
      .order("created_at", { ascending: true }),
    supabase
      .from("ticket_events")
      .select("event_type, new_value, created_at")
      .eq("ticket_id", ticket.id)
      .in("event_type", [...PUBLIC_EVENT_TYPES])
      .order("created_at", { ascending: true }),
  ]);
  if (
    commentsResult.error ||
    attachmentsResult.error ||
    eventsResult.error
  ) {
    console.error("Public ticket details failed:", {
      comments: commentsResult.error?.code,
      attachments: attachmentsResult.error?.code,
      events: eventsResult.error?.code,
    });
    return (
      <PublicTicketMessage
        title={t("unavailableTitle")}
        message={t("unavailable")}
        homeLabel={t("goHome")}
      />
    );
  }
  const comments = commentsResult.data;
  const attachments = attachmentsResult.data;
  const events = eventsResult.data;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto max-w-4xl px-4 py-3 sm:px-6 flex items-center justify-between gap-3">
          <Link href="/" className="flex min-h-11 items-center gap-3">
            <Image
              src="/logo.png"
              alt=""
              width={32}
              height={32}
              className="rounded-lg"
            />
            <span className="text-lg font-semibold text-foreground">
              Ripple
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {t("headerLabel")}
            </span>
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {/* Ticket Header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <span className="text-sm font-mono text-muted-foreground">
              {ticket.ticket_no}
            </span>
            <span className={`status-${ticket.status} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}>
              {label("status", ticket.status)}
            </span>
            <span className={`severity-${ticket.severity} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}>
              {ticket.severity}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">{ticket.title}</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            <div className="rounded-xl border border-border p-6">
              <h2 className="text-sm font-semibold text-foreground mb-3">
                {t("description")}
              </h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {ticket.description}
              </p>
            </div>

            {/* Resolution Summary */}
            {ticket.customer_visible_summary && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-6">
                <h2 className="text-sm font-semibold text-green-800 mb-3">
                  ✅ {t("resolutionSummary")}
                </h2>
                <p className="text-sm text-green-700 whitespace-pre-wrap">
                  {ticket.customer_visible_summary}
                </p>
              </div>
            )}

            {/* Comments */}
            <div className="rounded-xl border border-border p-6">
              <h2 className="text-sm font-semibold text-foreground mb-4">
                {t("updates")}
              </h2>
              {(!comments || comments.length === 0) ? (
                <p className="text-sm text-muted-foreground">
                  {t("noUpdates")}
                </p>
              ) : (
                <div className="space-y-4">
                  {comments.map((comment: PublicComment) => {
                    const author = singleRelation(comment.author);
                    const isStaff =
                      author?.role === "admin" || author?.role === "engineer";
                    return (
                    <div
                      key={comment.id}
                      className={
                        isStaff
                          ? "border-l-2 border-primary/40 pl-4"
                          : "border-l-2 border-slate-300 pl-4"
                      }
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-foreground">
                          {author ? author.full_name : t("submitter")}
                        </span>
                        {isStaff && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                            DropletAI
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {when(comment.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {comment.body}
                      </p>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            {acceptsReplies ? (
              <GuestReplyForm
                ticketNo={ticket.ticket_no}
                token={token}
                canReopen={canReopen}
                awaitingCustomer={ticket.status === "waiting_customer"}
              />
            ) : (
              <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground">
                {t.rich("closedNotice", {
                  ticketNo: ticket.ticket_no,
                  link: (chunks) => (
                    <Link href="/submit" className="font-medium text-primary hover:text-primary/80">
                      {chunks}
                    </Link>
                  ),
                })}
              </div>
            )}

            {/* Attachments */}
            {attachments && attachments.length > 0 && (
              <div className="rounded-xl border border-border p-6">
                <h2 className="text-sm font-semibold text-foreground mb-4">
                  {t("attachments")}
                </h2>
                <div className="space-y-2">
                  {attachments.map((att: { id: string; file_name: string; file_type: string; file_size: number }) => (
                    <div
                      key={att.id}
                      className="flex items-center gap-3 rounded-lg border border-border p-3"
                    >
                      <svg
                        className="h-5 w-5 text-muted-foreground"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                        />
                      </svg>
                      <div className="min-w-0">
                        <a
                          href={`/api/public/tickets/${encodeURIComponent(ticket.ticket_no)}/attachments/${att.id}?token=${encodeURIComponent(token)}`}
                          className="block break-all text-sm font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {att.file_name}
                          <span className="sr-only"> {t("download")}</span>
                        </a>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(att.file_size)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Details Card */}
            <div className="rounded-xl border border-border p-6 space-y-4">
              <h2 className="text-sm font-semibold text-foreground">
                {t("details")}
              </h2>
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("customer")}</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {customer?.name}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("site")}</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {site?.site_name}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("status")}</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {label("status", ticket.status)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("severity")}</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {label("severity", ticket.severity)}
                  </dd>
                </div>
                {ticket.impact && (
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("impact")}</dt>
                    <dd className="text-sm font-medium text-foreground">
                      {label("impact", ticket.impact)}
                    </dd>
                  </div>
                )}
                {ticket.asset_id && (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("equipment")}
                    </dt>
                    <dd className="text-sm font-medium text-foreground">
                      {ticket.asset_id}
                    </dd>
                  </div>
                )}
                {ticket.area && (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("area")}
                    </dt>
                    <dd className="text-sm font-medium text-foreground">
                      {ticket.area}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">{t("owner")}</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {owner?.full_name || t("pendingAssignment")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("created")}</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {when(ticket.created_at)}
                  </dd>
                </div>
                {ticket.resolved_at && (
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("resolved")}</dt>
                    <dd className="text-sm font-medium text-foreground">
                      {when(ticket.resolved_at)}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Timeline */}
            {events && events.length > 0 && (
              <div className="rounded-xl border border-border p-6">
                <h2 className="text-sm font-semibold text-foreground mb-4">
                  {t("timeline")}
                </h2>
                <div className="space-y-3">
                  {events.map((event: { event_type: string; new_value: string | null; created_at: string }, i: number) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="mt-1 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {when(event.created_at)}
                          </p>
                          <p className="text-xs text-foreground">
                            {event.event_type === "ticket_created" && t("eventCreated")}
                            {event.event_type === "status_changed" &&
                              t("eventStatus", { status: label("status", event.new_value) })}
                            {event.event_type === "owner_assigned" &&
                              t("eventAssigned")}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-12">
        <div className="mx-auto max-w-4xl px-6 py-8 text-center text-sm text-muted-foreground">
          {t("copyright", { year: new Date().getFullYear() })}
        </div>
      </footer>
    </div>
  );
}
