import type { SPRStatus } from "@/types/spare-parts";

/**
 * Part request workflow. Migration 057 enforces the same truth table in
 * Postgres; UI checks are guidance, not the boundary. Same-status updates
 * (notes, priority, tracking) are always allowed.
 */
export const SPARE_PART_REQUEST_TRANSITIONS: Record<
  SPRStatus,
  readonly SPRStatus[]
> = {
  requested: ["approved", "cancelled"],
  approved: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function canTransitionSparePartRequest(
  current: SPRStatus,
  next: SPRStatus
): boolean {
  return current === next || SPARE_PART_REQUEST_TRANSITIONS[current].includes(next);
}

/** Approval commits spend, so only administrators may grant it. */
export function sparePartRequestTransitionRequiresAdmin(
  current: SPRStatus,
  next: SPRStatus
): boolean {
  return next === "approved" && current !== "approved";
}
