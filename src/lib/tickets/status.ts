import type { TicketStatus } from "@/types/ticket";

/**
 * Compatibility state machine for Ripple's current eight ticket states.
 *
 * This maps the richer PRD v1.1 state matrix onto the statuses that exist in
 * the current schema. Migration 032 enforces the same truth table inside
 * Postgres so UI checks are guidance, not the security boundary.
 */
export const TICKET_STATUS_TRANSITIONS: Record<
  TicketStatus,
  readonly TicketStatus[]
> = {
  new: ["assigned"],
  assigned: [
    "in_progress",
    "waiting_customer",
    "waiting_droplet",
    "resolved",
  ],
  in_progress: [
    "assigned",
    "waiting_customer",
    "waiting_droplet",
    "resolved",
  ],
  waiting_customer: ["assigned", "in_progress", "resolved"],
  waiting_droplet: ["in_progress", "resolved"],
  resolved: ["closed", "reopened"],
  closed: ["reopened"],
  reopened: ["assigned", "in_progress"],
};

export function getAllowedTicketTransitions(
  currentStatus: TicketStatus
): readonly TicketStatus[] {
  return TICKET_STATUS_TRANSITIONS[currentStatus];
}

export function canTransitionTicketStatus(
  currentStatus: TicketStatus,
  nextStatus: TicketStatus
): boolean {
  return (
    currentStatus === nextStatus ||
    TICKET_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)
  );
}

export function ticketStatusRequiresOwner(status: TicketStatus): boolean {
  return status === "assigned" || status === "in_progress";
}

export function ticketStatusAcceptsAssignment(
  status: TicketStatus
): boolean {
  return status !== "resolved" && status !== "closed";
}

/** Matches migration 058: customers may reopen within 30 days of closure. */
export const CUSTOMER_REOPEN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function isCustomerReopenable(
  status: TicketStatus | string,
  closedAt: string | null | undefined,
  now = Date.now()
): boolean {
  if (status === "resolved") return true;
  if (status !== "closed" || !closedAt) return false;
  const closed = Date.parse(closedAt);
  return Number.isFinite(closed) && now - closed <= CUSTOMER_REOPEN_WINDOW_MS;
}
