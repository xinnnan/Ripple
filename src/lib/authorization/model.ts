export const ORGANIZATION_ROLES = [
  "organization_admin",
  "site_admin",
  "requester",
  "viewer",
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const CUSTOMER_MEMBERSHIP_STATUSES = [
  "invited",
  "active",
  "suspended",
  "revoked",
] as const;

export type CustomerMembershipStatus =
  (typeof CUSTOMER_MEMBERSHIP_STATUSES)[number];

export const TICKET_VISIBILITY_SCOPES = ["OWN", "SITE", "CUSTOMER"] as const;

export type TicketVisibilityScope =
  (typeof TICKET_VISIBILITY_SCOPES)[number];

export const SITE_ASSIGNMENT_ROLES = [
  "site_admin",
  "requester",
  "viewer",
] as const;

export type SiteAssignmentRole = (typeof SITE_ASSIGNMENT_ROLES)[number];

export const APPROVER_CAPABILITIES = [
  "onsite_appointment",
  "paid_service",
  "paid_parts",
  "out_of_scope_work",
] as const;

export type ApproverCapability = (typeof APPROVER_CAPABILITIES)[number];

export type EffectiveWindow = {
  effectiveFrom: string;
  effectiveTo: string | null;
};

/**
 * Shared temporal predicate for future membership, assignment, and internal
 * access grants. Invalid timestamps fail closed instead of widening access.
 */
export function isEffectiveAt(
  window: EffectiveWindow,
  at: Date = new Date()
): boolean {
  const effectiveFrom = Date.parse(window.effectiveFrom);
  const effectiveTo = window.effectiveTo
    ? Date.parse(window.effectiveTo)
    : null;
  const checkedAt = at.getTime();

  if (
    !Number.isFinite(effectiveFrom) ||
    !Number.isFinite(checkedAt) ||
    (effectiveTo !== null && !Number.isFinite(effectiveTo))
  ) {
    return false;
  }

  return effectiveFrom <= checkedAt &&
    (effectiveTo === null || checkedAt < effectiveTo);
}

export function isActiveMembershipAt(
  membership: EffectiveWindow & { status: CustomerMembershipStatus },
  at: Date = new Date()
): boolean {
  return membership.status === "active" && isEffectiveAt(membership, at);
}
