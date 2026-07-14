// Single source of truth for ticket creation.
//
// Both the public POST /api/tickets (web + authed modal) and the Slack
// view_submission handler go through this module. Two reasons we pulled
// it out of the route handlers:
//
//  1. The two call sites were drifting copy-paste of the same logic —
//     different site resolution, identical MAX+1 number generation,
//     identical insert + event + Slack post. Bugs were inevitable.
//
//  2. Future channels (email intake, P1 webhook, internal "create on
//     behalf of") should be one extra caller, not three to keep in sync.
//
// The functions are intentionally small and side-effect-aware:
//   - `resolveSite*` queries are pure reads
//   - `generateNextTicketNo` is a race-prone MAX+1 (see AGENTS.md §9)
//   - `createTicketCore` does the insert + event + (optional) Slack post
//
// All callers must be authenticated and authorised. This module does not
// check authz — it trusts its inputs.

import type { SupabaseClient } from "@supabase/supabase-js";
import { WebClient } from "@slack/web-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSecureToken, formatTicketNo } from "@/lib/utils";
import { buildMasterTicketMessage } from "@/lib/slack/blocks/ticket-master";
import type {
  Ticket,
  TicketSource,
  RequestType,
  Severity,
  Impact,
} from "@/types/ticket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateTicketInput {
  /** Already-resolved customer id (uuid). */
  customer_id: string;
  /** Already-resolved site id (uuid). */
  site_id: string;
  source: TicketSource;
  title: string;
  description: string;
  request_type: RequestType;
  severity: Severity;
  impact?: Impact | null;
  asset_id?: string | null;
  area?: string | null;
  /** Auth user id (uuid) of the requester, if known. */
  created_by?: string | null;
}

export interface CreateTicketOptions {
  /**
   * If provided, posts the master Block Kit message to this Slack channel
   * (when the site has a slack_channel_id and a bot token is configured).
   * Pass the channel id to post to; pass `false` to skip.
   */
  slackChannelId?: string | null;
  /**
   * Override the WebClient (e.g. from inside a Slack handler that already
   * has one). Falls back to constructing one from SLACK_BOT_TOKEN.
   */
  slackClient?: WebClient;
}

export interface CreateTicketResult {
  ticket: Ticket;
  ticket_no: string;
  secure_token: string;
  /** True iff we successfully posted the Slack master message. */
  postedToSlack: boolean;
}

// ---------------------------------------------------------------------------
// Site resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a site by its human-readable site_code (e.g. "INDY-01").
 * Returns the site's id + customer_id, or null if not found / inactive.
 */
export async function resolveSiteByCode(
  supabase: SupabaseClient,
  siteCode: string
): Promise<{ id: string; customer_id: string; slack_channel_id: string | null } | null> {
  const { data } = await supabase
    .from("sites")
    .select("id, customer_id, slack_channel_id")
    .eq("site_code", siteCode.toUpperCase())
    .eq("status", "active")
    .maybeSingle();
  return data ?? null;
}

/**
 * Resolve a site by its bound Slack channel id. Returns the same shape as
 * `resolveSiteByCode`, or null if the channel is not bound to any site.
 *
 * Use this from the Slack `/ticket` command and view_submission handler
 * where the only context we have is the channel the user is in.
 */
export async function resolveSiteBySlackChannel(
  supabase: SupabaseClient,
  channelId: string
): Promise<{ id: string; customer_id: string; slack_channel_id: string | null } | null> {
  const { data } = await supabase
    .from("slack_channels")
    .select("site_id, sites(id, customer_id, slack_channel_id)")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (!data) return null;
  const site = (Array.isArray(data.sites) ? data.sites[0] : data.sites) as
    | { id: string; customer_id: string; slack_channel_id: string | null }
    | null;
  if (!site) return null;
  return { ...site, slack_channel_id: data.site_id ? channelId : site.slack_channel_id };
}

// ---------------------------------------------------------------------------
// Ticket numbering
// ---------------------------------------------------------------------------

/**
 * Compute the next ticket number. Uses SELECT MAX + 1 — known to be racy
 * under high concurrency. See AGENTS.md §9. Acceptable for current volume.
 * Migration 019 (planned Sprint 2) will switch to a Postgres sequence.
 */
export async function generateNextTicketNo(supabase: SupabaseClient): Promise<string> {
  const { data: last } = await supabase
    .from("tickets")
    .select("ticket_no")
    .order("ticket_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastNum = last
    ? parseInt(last.ticket_no.replace("RPL-", ""), 10)
    : 0;
  return formatTicketNo((Number.isFinite(lastNum) ? lastNum : 0) + 1);
}

// ---------------------------------------------------------------------------
// Core create
// ---------------------------------------------------------------------------

/**
 * Insert a ticket, log a `ticket_created` event, and (optionally) post
 * the master Block Kit message to Slack. Returns the inserted row + a
 * `postedToSlack` flag so the caller can show different confirmation
 * copy based on whether the channel post succeeded.
 *
 * Errors from the Slack post are swallowed (ticket creation is the
 * primary success criterion; the master message can be regenerated from
 * the web portal).
 */
export async function createTicketCore(
  input: CreateTicketInput,
  options: CreateTicketOptions = {}
): Promise<CreateTicketResult> {
  const supabase = createAdminClient();

  const ticketNo = await generateNextTicketNo(supabase);
  const secureToken = generateSecureToken();

  const { data: ticket, error } = await supabase
    .from("tickets")
    .insert({
      ticket_no: ticketNo,
      customer_id: input.customer_id,
      site_id: input.site_id,
      source: input.source,
      title: input.title,
      description: input.description,
      request_type: input.request_type,
      severity: input.severity,
      status: "new",
      impact: input.impact ?? null,
      asset_id: input.asset_id ?? null,
      area: input.area ?? null,
      created_by: input.created_by ?? null,
      secure_token: secureToken,
    })
    .select(
      `
      *,
      customer:customers(id, name),
      site:sites(id, site_name, site_code, slack_channel_id),
      owner:users!tickets_owner_id_fkey(id, full_name, email),
      creator:users!tickets_created_by_fkey(id, full_name, email)
    `
    )
    .single();

  if (error || !ticket) {
    throw new Error(
      `Ticket insert failed: ${error?.message ?? "no row returned"}`
    );
  }

  // Log the creation event. Sole writer — DB trigger was dropped in 015.
  await supabase.from("ticket_events").insert({
    ticket_id: ticket.id,
    event_type: "ticket_created",
    old_value: null,
    new_value: "new",
    actor_id: input.created_by ?? null,
  });

  // Optional Slack post.
  const targetChannel =
    options.slackChannelId ??
    (Array.isArray(ticket.site) ? ticket.site[0] : ticket.site)?.slack_channel_id ??
    null;

  let postedToSlack = false;
  if (targetChannel) {
    const token = process.env.SLACK_BOT_TOKEN;
    const client =
      options.slackClient ?? (token ? new WebClient(token) : null);
    if (client) {
      try {
        const siteData = Array.isArray(ticket.site) ? ticket.site[0] : ticket.site;
        const customerData = Array.isArray(ticket.customer)
          ? ticket.customer[0]
          : ticket.customer;
        await client.chat.postMessage({
          channel: targetChannel,
          text: `🎫 New ticket: [${ticket.ticket_no}] ${ticket.title}`,
          blocks: buildMasterTicketMessage({
            ...ticket,
            customer: customerData as { id: string; name: string } | undefined,
            site: siteData as { id: string; site_name: string; site_code: string } | undefined,
            owner: undefined,
            creator: undefined,
          } as Ticket),
        });
        postedToSlack = true;
      } catch (e) {
        console.error("[createTicketCore] Slack post failed (non-fatal):", e);
      }
    }
  }

  return {
    ticket: ticket as Ticket,
    ticket_no: ticket.ticket_no,
    secure_token: ticket.secure_token,
    postedToSlack,
  };
}
