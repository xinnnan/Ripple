// SLA policy lookup + breach computation.
//
// Design (see supabase/migrations/024_create_sla_policies.sql):
//
//   sla_policies(id, name, customer_id?, is_default,
//                p{1..4}_response_minutes, p{1..4}_resolution_minutes)
//
//   tickets.sla_policy_id           — which policy was applied
//   tickets.first_response_due_at   — computed at create time
//   tickets.resolve_due_at          — computed at create time
//   tickets.first_response_at       — first human, customer-visible response
//   tickets.first_response_breached_at
//   tickets.resolution_breached_at  — milestone-specific breach timestamps
//   tickets.sla_breached            — compatibility aggregate
//
// Wall-clock for now (no business-hours). The hook is here for
// later: swap `addMinutes(date, minutes)` for a business-hours
// calendar without changing the call sites.
//
// The helpers below are the executable UI/test specification. Migration 026
// mirrors these rules in row-locked database commands, which are authoritative
// for persistence across web and Slack.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Severity, TicketStatus, UserRole } from "@/types/ticket";

export interface SLAPolicy {
  id: string;
  name: string;
  customer_id: string | null;
  is_default: boolean;
  p1_response_minutes: number;
  p1_resolution_minutes: number;
  p2_response_minutes: number;
  p2_resolution_minutes: number;
  p3_response_minutes: number;
  p3_resolution_minutes: number;
  p4_response_minutes: number;
  p4_resolution_minutes: number;
}

export interface SLATargets {
  policyId: string;
  responseDueAt: Date | null;
  resolveDueAt: Date | null;
}

/**
 * Look up the per-severity target for a given severity from a
 * loaded policy. Returns the minutes, or null if the severity is
 * not in the policy (defence in depth — Zod on the API should
 * keep the policy rows constrained to P1..P4).
 */
export function getResponseMinutes(
  policy: SLAPolicy,
  severity: Severity
): number | null {
  switch (severity) {
    case "P1": return policy.p1_response_minutes;
    case "P2": return policy.p2_response_minutes;
    case "P3": return policy.p3_response_minutes;
    case "P4": return policy.p4_response_minutes;
  }
}

export function getResolutionMinutes(
  policy: SLAPolicy,
  severity: Severity
): number | null {
  switch (severity) {
    case "P1": return policy.p1_resolution_minutes;
    case "P2": return policy.p2_resolution_minutes;
    case "P3": return policy.p3_resolution_minutes;
    case "P4": return policy.p4_resolution_minutes;
  }
}

/**
 * Compute the response + resolution due times for a new ticket
 * based on the policy + severity + creation timestamp. Both fields
 * are null when the severity is unknown (we still apply the policy
 * to keep the row linked for reporting, but we can't compute a
 * target we don't have).
 */
export function computeSlaTargets(args: {
  policy: SLAPolicy;
  severity: Severity;
  createdAt: Date;
}): SLATargets {
  const resp = getResponseMinutes(args.policy, args.severity);
  const reso = getResolutionMinutes(args.policy, args.severity);
  return {
    policyId: args.policy.id,
    responseDueAt: resp == null ? null : addMinutes(args.createdAt, resp),
    resolveDueAt: reso == null ? null : addMinutes(args.createdAt, reso),
  };
}

/**
 * The DB doesn't have a "+ interval N minutes" overload in JS, so
 * we keep this tiny helper here. Centralised so the (future)
 * business-hours swap is one edit.
 */
export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

// ---------------------------------------------------------------------------
// Breach status — pure computation for the UI
// ---------------------------------------------------------------------------

/**
 * The "current" SLA state of a ticket, computed from the
 * stored columns + the current wall-clock time.
 *
 *   on_track   : no breach yet, still inside both windows
 *   response_breached : first response due has passed AND no
 *                       first response was given
 *   resolution_breached : resolve due has passed AND the ticket
 *                         is still open
 *   met        : resolved (or closed) within the target
 *   not_applicable : no SLA policy attached (e.g. P5 / unknown)
 */
export type SLAStatus =
  | "on_track"
  | "response_breached"
  | "resolution_breached"
  | "met"
  | "not_applicable";

export interface SLAState {
  status: SLAStatus;
  /** Minutes until due, or margin at achievement. Positive = on time. */
  responseDeltaMinutes: number | null;
  /** Minutes until due, or margin at achievement. Positive = on time. */
  resolutionDeltaMinutes: number | null;
  /** The earlier of responseDueAt / resolveDueAt — used by lists. */
  earliestDueAt: Date | null;
}

export function computeSLAState(args: {
  ticket: {
    severity: Severity;
    status: TicketStatus;
    first_response_due_at: string | null;
    resolve_due_at: string | null;
    first_response_at: string | null;
    resolved_at: string | null;
    first_response_breached_at: string | null;
    resolution_breached_at: string | null;
  };
  /** Optional override (for tests); defaults to now. */
  now?: Date;
}): SLAState {
  const now = args.now ?? new Date();
  const { ticket } = args;

  // Tickets without a policy have no SLA — caller already decided
  // the policy is not_applicable. (vs. we could return on_track
  // here; the API layer is the one that knows whether the policy
  // is attached.)
  if (!ticket.first_response_due_at && !ticket.resolve_due_at) {
    return {
      status: "not_applicable",
      responseDeltaMinutes: null,
      resolutionDeltaMinutes: null,
      earliestDueAt: null,
    };
  }

  let status: SLAStatus = "on_track";
  let responseDelta: number | null = null;
  let resolutionDelta: number | null = null;
  const isComplete =
    ticket.status === "resolved" || ticket.status === "closed";
  const responseBreached =
    ticket.first_response_breached_at !== null ||
    isMilestoneLate({
      dueAt: ticket.first_response_due_at,
      achievedAt: ticket.first_response_at,
    }) ||
    (
      !ticket.first_response_at &&
      !!ticket.first_response_due_at &&
      new Date(ticket.first_response_due_at).getTime() < now.getTime()
    );
  const resolutionBreached =
    ticket.resolution_breached_at !== null ||
    isMilestoneLate({
      dueAt: ticket.resolve_due_at,
      achievedAt: ticket.resolved_at,
    }) ||
    (
      !isComplete &&
      !!ticket.resolve_due_at &&
      new Date(ticket.resolve_due_at).getTime() < now.getTime()
    );

  if (ticket.first_response_due_at) {
    const due = new Date(ticket.first_response_due_at);
    const reference = ticket.first_response_at
      ? new Date(ticket.first_response_at)
      : now;
    responseDelta = (due.getTime() - reference.getTime()) / 60_000;
  }

  if (ticket.resolve_due_at) {
    const due = new Date(ticket.resolve_due_at);
    const reference = ticket.resolved_at ? new Date(ticket.resolved_at) : now;
    resolutionDelta = (due.getTime() - reference.getTime()) / 60_000;
  }

  if (resolutionBreached) {
    status = "resolution_breached";
  } else if (responseBreached) {
    status = "response_breached";
  } else if (isComplete && ticket.resolved_at) {
    status = "met";
  } else if (isComplete) {
    // Closing without an achieved Resolution milestone must never be
    // represented as "met". INT-001 will separately prevent this transition.
    status = "resolution_breached";
  }

  // Earliest deadline for list-view "next milestone" rendering.
  let earliest: Date | null = null;
  if (!isComplete && ticket.first_response_due_at && !ticket.first_response_at) {
    earliest = new Date(ticket.first_response_due_at);
  }
  if (!isComplete && ticket.resolve_due_at) {
    const r = new Date(ticket.resolve_due_at);
    if (!earliest || r < earliest) earliest = r;
  }

  return {
    status,
    responseDeltaMinutes: responseDelta,
    resolutionDeltaMinutes: resolutionDelta,
    earliestDueAt: earliest,
  };
}

// ---------------------------------------------------------------------------
// Milestone truth-table helpers
// ---------------------------------------------------------------------------

/**
 * PRD v1.1 metric definition:
 * Ticket Created -> First Human Customer-Visible Response.
 *
 * The author must be internal, the message must be customer-visible, and it
 * must not be automated. Assignment, status changes, internal notes, customer
 * replies, and automated acknowledgements are therefore excluded.
 */
export function isFirstHumanCustomerVisibleResponse(args: {
  authorRole: UserRole;
  visibility: "customer" | "internal";
  isAutomated: boolean;
  alreadyAchieved: boolean;
}): boolean {
  return (
    !args.alreadyAchieved &&
    !args.isAutomated &&
    args.visibility === "customer" &&
    (args.authorRole === "admin" || args.authorRole === "engineer")
  );
}

/**
 * A milestone completed exactly at its due timestamp is met. Only an actual
 * completion later than the due timestamp is breached.
 */
export function isMilestoneLate(args: {
  dueAt: string | null;
  achievedAt: string | null;
}): boolean {
  if (!args.dueAt || !args.achievedAt) return false;
  return (
    new Date(args.achievedAt).getTime() > new Date(args.dueAt).getTime()
  );
}

// ---------------------------------------------------------------------------
// Policy lookup — DB-facing helpers
// ---------------------------------------------------------------------------

/**
 * Find the SLA policy for a customer. Resolution order:
 *
 *   1. The customer_id-scoped policy (one per customer, enforced
 *      by a partial unique index in migration 024).
 *   2. The default policy (one in the table, is_default = true).
 *
 * Returns null if neither is found — caller decides whether to
 * skip the SLA entirely or hard-fail. (We skip: a customer with
 * no policy and no default is "SLA not_applicable".)
 */
export async function findPolicyForCustomer(
  supabase: SupabaseClient,
  customerId: string
): Promise<SLAPolicy | null> {
  const { data: customerPolicy } = await supabase
    .from("sla_policies")
    .select("*")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (customerPolicy) return customerPolicy as SLAPolicy;

  const { data: defaultPolicy } = await supabase
    .from("sla_policies")
    .select("*")
    .eq("is_default", true)
    .maybeSingle();
  return (defaultPolicy as SLAPolicy | null) ?? null;
}
