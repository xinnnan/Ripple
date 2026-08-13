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
//   - `createTicketCore` calls one command; migrations 034/047 atomically record
//     timeline/audit/outbox effects and deduplicate exact request replays
//
// Callers must resolve site/source context. The database command independently
// validates active actor and site scope; null actors are allowed only for the
// public web and signed Slack intake paths.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WebClient } from "@slack/web-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSecureToken } from "@/lib/utils";
import { dispatchTicketOutboxBestEffort } from "@/lib/tickets/outbox";
import { computeSlaTargets, findPolicyForCustomer } from "@/lib/sla";
import { normalizeSiteCode } from "@/lib/sites/site-code";
import type { TicketSource, RequestType, Severity, Impact } from "@/types/ticket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateTicketInput {
  /** Already-resolved customer id (uuid). */
  customer_id: string;
  /** Already-resolved site id (uuid). */
  site_id: string;
  source: TicketSource;
  /** Stable per-attempt key reused only when replaying the same command. */
  idempotency_key: string;
  title: string;
  description: string;
  request_type: RequestType;
  severity: Severity;
  impact?: Impact | null;
  asset_id?: string | null;
  area?: string | null;
  /** Auth user id (uuid) of the requester, if known. */
  created_by?: string | null;
  /** Contact info for the submitter (used for confirmation email and
   *  to reach the customer later). Optional — internal/auto-created
   *  tickets may not have these. */
  submitter_name?: string | null;
  submitter_email?: string | null;
  submitter_phone?: string | null;
}

export interface CreateTicketOptions {
  /**
   * Override the persisted site channel while immediately draining the
   * durable master-message outbox event.
   */
  slackChannelId?: string | null;
  /**
   * Override the WebClient (e.g. from inside a Slack handler that already
   * has one). Falls back to constructing one from SLACK_BOT_TOKEN.
   */
  slackClient?: WebClient;
}

export interface CreateTicketResult {
  ticket_id: string;
  ticket_no: string;
  secure_token: string;
}

function isTicketCreationReceipt(
  value: unknown
): value is { id: string; ticket_no: string; secure_token: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "ticket_no" in value &&
    typeof value.ticket_no === "string" &&
    "secure_token" in value &&
    typeof value.secure_token === "string"
  );
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
  const { data, error } = await supabase
    .from("sites")
    .select(
      "id, customer_id, slack_channel_id, customer:customers!inner(status)"
    )
    .eq("site_code", normalizeSiteCode(siteCode))
    .eq("status", "active")
    .in("customer.status", ["active", "trial"])
    .maybeSingle();
  if (error) {
    throw new Error("Site-code resolution failed");
  }
  if (!data) return null;
  return {
    id: data.id,
    customer_id: data.customer_id,
    slack_channel_id: data.slack_channel_id,
  };
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
  // `sites.slack_channel_id` is the canonical admin selection. Migration 053
  // transactionally materializes the operational slack_channels row used for
  // message receipts, but ingress authorization must not accept a stale
  // historical mapping after a site is unlinked or moved.
  const { data, error } = await supabase
    .from("sites")
    .select(
      "id, customer_id, slack_channel_id, customer:customers!inner(status)"
    )
    .eq("slack_channel_id", channelId)
    .eq("status", "active")
    .in("customer.status", ["active", "trial"])
    .maybeSingle();
  if (error) throw new Error("Slack-channel site resolution failed");
  if (!data) return null;
  return {
    id: data.id,
    customer_id: data.customer_id,
    slack_channel_id: data.slack_channel_id,
  };
}

// ---------------------------------------------------------------------------
// Core create
// ---------------------------------------------------------------------------

/**
 * Insert or replay a ticket once. Migration 034 validates the creator/site
 * boundary and atomically writes the creation event, audit row, and durable
 * outbox records. Migration 047 serializes a stable request key around it.
 */
export async function createTicketCore(
  input: CreateTicketInput,
  options: CreateTicketOptions = {}
): Promise<CreateTicketResult> {
  const supabase = createAdminClient();

  const secureToken = generateSecureToken();

  // Look up the customer's SLA policy (per-customer or default)
  // and compute the response + resolution due times. If there's
  // no policy at all, the ticket still gets created — just
  // without SLA columns, which the UI surfaces as "no SLA".
  const createdAt = new Date();
  let slaPolicyId: string | null = null;
  let firstResponseDueAt: string | null = null;
  let resolveDueAt: string | null = null;
  try {
    const policy = await findPolicyForCustomer(supabase, input.customer_id);
    if (policy) {
      const targets = computeSlaTargets({
        policy,
        severity: input.severity,
        createdAt,
      });
      slaPolicyId = targets.policyId;
      firstResponseDueAt = targets.responseDueAt?.toISOString() ?? null;
      resolveDueAt = targets.resolveDueAt?.toISOString() ?? null;
    }
  } catch (error) {
    // SLA lookup is best-effort — a failed policy fetch must not
    // block ticket creation. The ticket is created without SLA,
    // which the UI can flag if it becomes a pattern.
    console.warn("[tickets] SLA policy lookup failed (non-fatal):", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
  }

  const { data: receipt, error: commandError } = await supabase.rpc(
    "create_ticket_idempotent_atomic",
    {
      p_input: {
        customer_id: input.customer_id,
        site_id: input.site_id,
        source: input.source,
        title: input.title,
        description: input.description,
        request_type: input.request_type,
        severity: input.severity,
        impact: input.impact ?? null,
        asset_id: input.asset_id ?? null,
        area: input.area ?? null,
        created_by: input.created_by ?? null,
        submitter_name: input.submitter_name ?? null,
        submitter_email: input.submitter_email ?? null,
        submitter_phone: input.submitter_phone ?? null,
        secure_token: secureToken,
        sla_policy_id: slaPolicyId,
        first_response_due_at: firstResponseDueAt,
        resolve_due_at: resolveDueAt,
        idempotency_key: input.idempotency_key,
      },
    }
  );

  if (commandError || !isTicketCreationReceipt(receipt)) {
    throw new Error("Atomic ticket creation failed");
  }

  await dispatchTicketOutboxBestEffort({
    aggregateId: receipt.id,
    slackOptions: {
      channelId: options.slackChannelId,
      client: options.slackClient,
    },
  });

  return {
    ticket_id: receipt.id,
    ticket_no: receipt.ticket_no,
    secure_token: receipt.secure_token,
  };
}
