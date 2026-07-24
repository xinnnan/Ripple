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
//   tickets.first_response_at       — stamped by the API on the
//                                     first internal comment / status
//                                     change
//   tickets.sla_breached            — true once any SLA is missed
//
// Wall-clock for now (no business-hours). The hook is here for
// later: swap `addMinutes(date, minutes)` for a business-hours
// calendar without changing the call sites.
//
// The helpers are pure functions of the policy + ticket; they
// don't touch the DB. The API layer is responsible for writing the
// computed values back.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Severity, TicketStatus } from "@/types/ticket";

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
  /** Minutes until / since the response due. Positive = remaining. */
  responseDeltaMinutes: number | null;
  /** Minutes until / since the resolve due. Positive = remaining. */
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
    sla_breached: boolean;
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

  // Resolved/closed tickets report on whether the SLA was met.
  if (ticket.status === "resolved" || ticket.status === "closed") {
    return {
      status: ticket.sla_breached ? "resolution_breached" : "met",
      responseDeltaMinutes: null,
      resolutionDeltaMinutes: null,
      earliestDueAt: null,
    };
  }

  // Open ticket. Compare each deadline to now.
  let status: SLAStatus = "on_track";
  let responseDelta: number | null = null;
  let resolutionDelta: number | null = null;

  if (ticket.first_response_due_at) {
    const due = new Date(ticket.first_response_due_at);
    responseDelta = (due.getTime() - now.getTime()) / 60_000;
    // Breached when due has passed AND no first response was given.
    if (!ticket.first_response_at && responseDelta < 0) {
      status = "response_breached";
    }
  }

  if (ticket.resolve_due_at) {
    const due = new Date(ticket.resolve_due_at);
    resolutionDelta = (due.getTime() - now.getTime()) / 60_000;
    // Resolution breach dominates response breach in display —
    // a P1 that's about to be late on response AND is already past
    // its resolve due is a bigger alarm than just response-late.
    if (resolutionDelta < 0) {
      status = "resolution_breached";
    }
  }

  // Earliest deadline for list-view "next milestone" rendering.
  let earliest: Date | null = null;
  if (ticket.first_response_due_at && (!ticket.first_response_at)) {
    earliest = new Date(ticket.first_response_due_at);
  }
  if (ticket.resolve_due_at) {
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
// Apply helpers — the API calls these to decide what to stamp on
// the row at each transition.
// ---------------------------------------------------------------------------

/**
 * Should we set first_response_at on this transition? Returns
 * true the first time we see a non-`new` event (engineer action)
 * for a ticket that doesn't already have a first_response_at.
 *
 * What counts as a "response":
 *   1. A new internal comment (the caller passes a flag for this)
 *   2. The status leaving `new` (someone took ownership / changed
 *      severity / opened the AI assist / whatever)
 *
 * Customer-visible comments do NOT count — the customer talking
 * back to us isn't us responding to them.
 */
export function isFirstResponseEvent(args: {
  isInternalComment: boolean;
  statusChanged: boolean;
  oldStatus: TicketStatus | null;
  newStatus: TicketStatus | null;
  hadFirstResponse: boolean;
}): boolean {
  if (args.hadFirstResponse) return false;
  if (args.isInternalComment) return true;
  if (
    args.statusChanged &&
    args.oldStatus === "new" &&
    args.newStatus !== "new" &&
    args.newStatus !== undefined
  ) {
    return true;
  }
  return false;
}

/**
 * Compute sla_breached for an in-flight ticket. Returns the
 * boolean that should be written to tickets.sla_breached.
 *
 *   - response breach: now > first_response_due_at AND no first response
 *   - resolution breach: now > resolve_due_at AND still open
 *
 * The caller passes `now` (so tests can drive the clock); in
 * production `undefined` -> Date.now().
 */
export function computeSlaBreached(args: {
  status: TicketStatus;
  first_response_due_at: string | null;
  resolve_due_at: string | null;
  first_response_at: string | null;
  now?: Date;
}): boolean {
  const now = args.now ?? new Date();
  if (args.first_response_due_at && !args.first_response_at) {
    if (new Date(args.first_response_due_at).getTime() < now.getTime()) {
      return true;
    }
  }
  if (args.resolve_due_at && args.status !== "resolved" && args.status !== "closed") {
    if (new Date(args.resolve_due_at).getTime() < now.getTime()) {
      return true;
    }
  }
  return false;
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
