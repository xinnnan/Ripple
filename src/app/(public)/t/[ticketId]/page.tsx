import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
import { STATUS_LABELS, SEVERITY_LABELS, IMPACT_LABELS } from "@/types/ticket";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

interface Props {
  params: Promise<{ ticketId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function TicketViewPage({ params, searchParams }: Props) {
  const { ticketId } = await params;
  const { token } = await searchParams;

  // Rate limit: this page is unauthed and gated by a 32-byte
  // secure_token. The token is unguessable in practice, but a
  // determined attacker could still hammer the page with random
  // tokens to probe the system or to extract timing info. Cap
  // unauthed lookups at 30/min/IP. (The token itself limits who
  // actually sees a ticket; this just blocks the brute-force
  // surface area.)
  const hdrs = await headers();
  const ip = getClientIp(hdrs);
  const rl = rateLimit({ key: `t-page:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-foreground mb-2">Too Many Requests</h1>
          <p className="text-muted-foreground">
            You have exceeded the rate limit for ticket lookups. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-foreground mb-2">
            Access Denied
          </h1>
          <p className="text-muted-foreground">
            A valid access token is required to view this ticket.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block text-sm font-medium text-primary hover:text-primary/80"
          >
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  const supabase = createAdminClient();

  // Fetch ticket by ID and secure token
  const { data: ticket, error } = await supabase
    .from("tickets")
    .select(
      `
      *,
      customer:customers(id, name),
      site:sites(id, site_name, site_code),
      owner:users!tickets_owner_id_fkey(id, full_name)
    `
    )
    .eq("ticket_no", ticketId)
    .eq("secure_token", token)
    .single();

  if (error || !ticket) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-foreground mb-2">
            Ticket Not Found
          </h1>
          <p className="text-muted-foreground">
            This ticket may not exist or your access link may be invalid.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block text-sm font-medium text-primary hover:text-primary/80"
          >
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  // Fetch customer-visible comments only
  const { data: comments } = await supabase
    .from("ticket_comments")
    .select("id, body, visibility, source, created_at, author:users(full_name)")
    .eq("ticket_id", ticket.id)
    .eq("visibility", "customer")
    .order("created_at", { ascending: true });

  // Fetch customer-visible attachments
  const { data: attachments } = await supabase
    .from("ticket_attachments")
    .select("id, file_name, file_type, file_size, created_at")
    .eq("ticket_id", ticket.id)
    .eq("visibility", "customer")
    .order("created_at", { ascending: true });

  // Fetch ticket events for timeline
  const { data: events } = await supabase
    .from("ticket_events")
    .select("event_type, old_value, new_value, created_at")
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: true });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">
                R
              </span>
            </div>
            <span className="text-lg font-semibold text-foreground">
              Ripple
            </span>
          </Link>
          <span className="text-sm text-muted-foreground">
            Ticket Status
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Ticket Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-sm font-mono text-muted-foreground">
              {ticket.ticket_no}
            </span>
            <span className={`status-${ticket.status} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}>
              {STATUS_LABELS[ticket.status as keyof typeof STATUS_LABELS]}
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
                Description
              </h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {ticket.description}
              </p>
            </div>

            {/* Resolution Summary */}
            {ticket.customer_visible_summary && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-6">
                <h2 className="text-sm font-semibold text-green-800 mb-3">
                  ✅ Resolution Summary
                </h2>
                <p className="text-sm text-green-700 whitespace-pre-wrap">
                  {ticket.customer_visible_summary}
                </p>
              </div>
            )}

            {/* Comments */}
            <div className="rounded-xl border border-border p-6">
              <h2 className="text-sm font-semibold text-foreground mb-4">
                Updates & Comments
              </h2>
              {(!comments || comments.length === 0) ? (
                <p className="text-sm text-muted-foreground">
                  No updates yet. Our team is working on your ticket.
                </p>
              ) : (
                <div className="space-y-4">
                  {comments.map((comment: { id: string; body: string; created_at: string; author: { full_name: string }[] }) => (
                    <div key={comment.id} className="border-l-2 border-primary/30 pl-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-foreground">
                          {comment.author?.[0]?.full_name || "Support Team"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(comment.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {comment.body}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Attachments */}
            {attachments && attachments.length > 0 && (
              <div className="rounded-xl border border-border p-6">
                <h2 className="text-sm font-semibold text-foreground mb-4">
                  Attachments
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
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {att.file_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(att.file_size / 1024).toFixed(1)} KB
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
                Ticket Details
              </h2>
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Customer</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {ticket.customer?.name}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Site</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {ticket.site?.site_name}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Status</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {STATUS_LABELS[ticket.status as keyof typeof STATUS_LABELS]}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Severity</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {SEVERITY_LABELS[ticket.severity as keyof typeof SEVERITY_LABELS]}
                  </dd>
                </div>
                {ticket.impact && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Impact</dt>
                    <dd className="text-sm font-medium text-foreground">
                      {IMPACT_LABELS[ticket.impact as keyof typeof IMPACT_LABELS]}
                    </dd>
                  </div>
                )}
                {ticket.asset_id && (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Equipment
                    </dt>
                    <dd className="text-sm font-medium text-foreground">
                      {ticket.asset_id}
                    </dd>
                  </div>
                )}
                {ticket.area && (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Area / Process
                    </dt>
                    <dd className="text-sm font-medium text-foreground">
                      {ticket.area}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">Owner</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {ticket.owner?.full_name || "Pending assignment"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Created</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {formatDate(ticket.created_at)}
                  </dd>
                </div>
                {ticket.resolved_at && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Resolved</dt>
                    <dd className="text-sm font-medium text-foreground">
                      {formatDate(ticket.resolved_at)}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Timeline */}
            {events && events.length > 0 && (
              <div className="rounded-xl border border-border p-6">
                <h2 className="text-sm font-semibold text-foreground mb-4">
                  Activity Timeline
                </h2>
                <div className="space-y-3">
                  {events
                    .filter((e: { event_type: string }) =>
                      ["ticket_created", "status_changed", "owner_assigned"].includes(e.event_type)
                    )
                    .map((event: { event_type: string; new_value: string | null; created_at: string }, i: number) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="mt-1 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(event.created_at)}
                          </p>
                          <p className="text-xs text-foreground">
                            {event.event_type === "ticket_created" && "Ticket created"}
                            {event.event_type === "status_changed" &&
                              `Status → ${STATUS_LABELS[event.new_value as keyof typeof STATUS_LABELS] || event.new_value}`}
                            {event.event_type === "owner_assigned" &&
                              "Engineer assigned"}
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
          © {new Date().getFullYear()} DropletAI Services. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
