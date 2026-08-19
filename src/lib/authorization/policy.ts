import {
  APPROVER_CAPABILITIES,
  CUSTOMER_MEMBERSHIP_STATUSES,
  isActiveMembershipAt,
  isEffectiveAt,
  ORGANIZATION_ROLES,
  SITE_ASSIGNMENT_ROLES,
  TICKET_VISIBILITY_SCOPES,
  type ApproverCapability,
  type CustomerMembershipStatus,
  type OrganizationRole,
  type SiteAssignmentRole,
  type TicketVisibilityScope,
} from "./model";

export const CUSTOMER_POLICY_ACTIONS = [
  "customer.read",
  "customer.manage",
  "site.read",
  "site.manage",
  "ticket.read",
  "ticket.create",
  "ticket.comment",
  "approval.decide",
] as const;

export type CustomerPolicyAction = (typeof CUSTOMER_POLICY_ACTIONS)[number];

export const CUSTOMER_CONTENT_VISIBILITIES = [
  "CUSTOMER_VISIBLE",
  "INTERNAL_ONLY",
  "RESTRICTED_INTERNAL",
  "APPROVER_ONLY",
] as const;

export type CustomerContentVisibility =
  (typeof CUSTOMER_CONTENT_VISIBILITIES)[number];

export const CUSTOMER_POLICY_DENY_REASONS = [
  "INVALID_REQUEST",
  "ACTOR_NOT_FOUND",
  "ACTOR_INACTIVE",
  "CUSTOMER_NOT_FOUND",
  "CUSTOMER_INACTIVE",
  "MEMBERSHIP_NOT_FOUND",
  "MEMBERSHIP_INVALID",
  "MEMBERSHIP_INACTIVE",
  "MEMBERSHIP_NOT_EFFECTIVE",
  "ROLE_FORBIDDEN",
  "VISIBILITY_REQUIRED",
  "VISIBILITY_FORBIDDEN",
  "APPROVER_CAPABILITY_REQUIRED",
  "SITE_REQUIRED",
  "SITE_NOT_FOUND",
  "SITE_INVALID",
  "SITE_TENANT_MISMATCH",
  "SITE_ASSIGNMENT_REQUIRED",
  "SITE_ASSIGNMENT_INVALID",
  "SITE_ASSIGNMENT_NOT_EFFECTIVE",
  "SITE_ROLE_FORBIDDEN",
  "SITE_INACTIVE_FOR_ACTION",
  "OBJECT_SCOPE_FORBIDDEN",
] as const;

export type CustomerPolicyDenyReason =
  (typeof CUSTOMER_POLICY_DENY_REASONS)[number];

export interface CustomerPolicyActor {
  id: string;
  status: string;
}

export interface CustomerPolicyCustomer {
  id: string;
  status: string;
}

export interface CustomerPolicySite {
  id: string;
  customerId: string;
  status: string;
}

export interface CustomerPolicyMembership {
  id: string;
  userId: string;
  customerId: string;
  organizationRole: OrganizationRole;
  status: CustomerMembershipStatus;
  ticketVisibilityScope: TicketVisibilityScope;
  approverCapabilities: ApproverCapability[];
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface CustomerPolicySiteAssignment {
  id: string;
  membershipId: string;
  customerId: string;
  siteId: string;
  siteRole: SiteAssignmentRole;
  objectScope: Exclude<TicketVisibilityScope, "CUSTOMER"> | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface CustomerPolicyObjectContext {
  visibility?: CustomerContentVisibility;
  /** Ticket creator, participants, and explicitly shared users. */
  actorIds?: string[];
  requiredApproverCapability?: ApproverCapability;
}

export interface CustomerPolicyRequest {
  actorId: string;
  customerId: string;
  siteId?: string | null;
  action: CustomerPolicyAction;
  object?: CustomerPolicyObjectContext;
}

/** Resource request shape for server adapters; actor identity is separate. */
export type CustomerPolicyResourceRequest = Omit<
  CustomerPolicyRequest,
  "actorId"
>;

export interface CustomerPolicyInput {
  request: CustomerPolicyRequest;
  actor: CustomerPolicyActor | null;
  customer: CustomerPolicyCustomer | null;
  membership: CustomerPolicyMembership | null;
  site: CustomerPolicySite | null;
  assignment: CustomerPolicySiteAssignment | null;
  at?: Date;
}

export interface CustomerPolicyAllowance {
  allowed: true;
  actorId: string;
  customerId: string;
  siteId: string | null;
  membershipId: string;
  organizationRole: OrganizationRole;
  siteRole: SiteAssignmentRole | null;
  effectiveTicketScope: TicketVisibilityScope;
  approverCapabilities: ApproverCapability[];
}

export interface CustomerPolicyDenial {
  allowed: false;
  reason: CustomerPolicyDenyReason;
}

export type CustomerPolicyDecision =
  | CustomerPolicyAllowance
  | CustomerPolicyDenial;

const READ_ACTIONS = new Set<CustomerPolicyAction>([
  "customer.read",
  "site.read",
  "ticket.read",
]);

const SITE_ACTIONS = new Set<CustomerPolicyAction>([
  "site.read",
  "site.manage",
  "ticket.read",
  "ticket.create",
  "ticket.comment",
  "approval.decide",
]);

const TICKET_VISIBILITY_ACTIONS = new Set<CustomerPolicyAction>([
  "ticket.read",
  "ticket.comment",
  "approval.decide",
]);

const ORGANIZATION_ACTIONS: Record<
  OrganizationRole,
  ReadonlySet<CustomerPolicyAction>
> = {
  organization_admin: new Set(CUSTOMER_POLICY_ACTIONS),
  site_admin: new Set([
    "customer.read",
    "site.read",
    "site.manage",
    "ticket.read",
    "ticket.create",
    "ticket.comment",
    "approval.decide",
  ]),
  requester: new Set([
    "customer.read",
    "site.read",
    "ticket.read",
    "ticket.create",
    "ticket.comment",
    "approval.decide",
  ]),
  viewer: new Set(["customer.read", "site.read", "ticket.read"]),
};

const SITE_ACTIONS_BY_ROLE: Record<
  SiteAssignmentRole,
  ReadonlySet<CustomerPolicyAction>
> = {
  site_admin: new Set([
    "site.read",
    "site.manage",
    "ticket.read",
    "ticket.create",
    "ticket.comment",
    "approval.decide",
  ]),
  requester: new Set([
    "site.read",
    "ticket.read",
    "ticket.create",
    "ticket.comment",
    "approval.decide",
  ]),
  viewer: new Set(["site.read", "ticket.read"]),
};

const ROLE_MAXIMUM_SCOPE: Record<OrganizationRole, TicketVisibilityScope> = {
  organization_admin: "CUSTOMER",
  site_admin: "SITE",
  requester: "SITE",
  viewer: "SITE",
};

const SCOPE_RANK: Record<TicketVisibilityScope, number> = {
  OWN: 0,
  SITE: 1,
  CUSTOMER: 2,
};

const CUSTOMER_SITE_STATUSES = [
  "active",
  "inactive",
  "commissioning",
  "decommissioned",
] as const;

function deny(reason: CustomerPolicyDenyReason): CustomerPolicyDenial {
  return { allowed: false, reason };
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value
    )
  );
}

function includesValue<T extends string>(
  values: readonly T[],
  value: unknown
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function narrowestScope(
  ...scopes: (TicketVisibilityScope | null)[]
): TicketVisibilityScope {
  return scopes
    .filter((scope): scope is TicketVisibilityScope => scope !== null)
    .reduce((narrowest, scope) =>
      SCOPE_RANK[scope] < SCOPE_RANK[narrowest] ? scope : narrowest
    );
}

function requiresActiveSite(action: CustomerPolicyAction): boolean {
  return !READ_ACTIONS.has(action);
}

export function isCustomerPolicyRequestValid(
  request: CustomerPolicyRequest,
  at: Date
): boolean {
  const object = request.object;
  return (
    isUuid(request.actorId) &&
    isUuid(request.customerId) &&
    (request.siteId === undefined ||
      request.siteId === null ||
      isUuid(request.siteId)) &&
    includesValue(CUSTOMER_POLICY_ACTIONS, request.action) &&
    Number.isFinite(at.getTime()) &&
    (object?.visibility === undefined ||
      includesValue(CUSTOMER_CONTENT_VISIBILITIES, object.visibility)) &&
    (object?.actorIds === undefined ||
      (Array.isArray(object.actorIds) &&
        object.actorIds.length <= 200 &&
        object.actorIds.every(isUuid))) &&
    (object?.requiredApproverCapability === undefined ||
      includesValue(
        APPROVER_CAPABILITIES,
        object.requiredApproverCapability
      ))
  );
}

function validateVisibility(
  request: CustomerPolicyRequest,
  membership: CustomerPolicyMembership
): CustomerPolicyDenial | null {
  if (!TICKET_VISIBILITY_ACTIONS.has(request.action)) return null;

  const visibility = request.object?.visibility;
  if (!visibility) return deny("VISIBILITY_REQUIRED");
  if (!includesValue(CUSTOMER_CONTENT_VISIBILITIES, visibility)) {
    return deny("VISIBILITY_FORBIDDEN");
  }
  if (visibility === "INTERNAL_ONLY" || visibility === "RESTRICTED_INTERNAL") {
    return deny("VISIBILITY_FORBIDDEN");
  }

  const requiredCapability = request.object?.requiredApproverCapability;
  if (request.action === "approval.decide" || visibility === "APPROVER_ONLY") {
    if (!includesValue(APPROVER_CAPABILITIES, requiredCapability)) {
      return deny("APPROVER_CAPABILITY_REQUIRED");
    }
    if (!membership.approverCapabilities.includes(requiredCapability)) {
      return deny("APPROVER_CAPABILITY_REQUIRED");
    }
  }

  return null;
}

/**
 * Pure PRD customer authorization evaluator. It never broadens access when a
 * role, lifecycle, temporal, tenant, assignment, object, or visibility input
 * is missing or malformed.
 */
export function evaluateCustomerPolicy(
  input: CustomerPolicyInput
): CustomerPolicyDecision {
  const { request, actor, customer, membership, site, assignment } = input;
  const at = input.at ?? new Date();

  if (!isCustomerPolicyRequestValid(request, at)) {
    return deny("INVALID_REQUEST");
  }

  if (!actor || actor.id !== request.actorId) return deny("ACTOR_NOT_FOUND");
  if (actor.status !== "active") return deny("ACTOR_INACTIVE");

  if (!customer || customer.id !== request.customerId) {
    return deny("CUSTOMER_NOT_FOUND");
  }
  if (customer.status !== "active" && customer.status !== "trial") {
    return deny("CUSTOMER_INACTIVE");
  }

  if (
    !membership ||
    membership.userId !== request.actorId ||
    membership.customerId !== request.customerId
  ) {
    return deny("MEMBERSHIP_NOT_FOUND");
  }
  if (
    !isUuid(membership.id) ||
    !includesValue(ORGANIZATION_ROLES, membership.organizationRole) ||
    !includesValue(CUSTOMER_MEMBERSHIP_STATUSES, membership.status) ||
    !includesValue(
      TICKET_VISIBILITY_SCOPES,
      membership.ticketVisibilityScope
    ) ||
    !Array.isArray(membership.approverCapabilities) ||
    membership.approverCapabilities.length > APPROVER_CAPABILITIES.length ||
    new Set(membership.approverCapabilities).size !==
      membership.approverCapabilities.length ||
    membership.approverCapabilities.some(
      (capability) => !includesValue(APPROVER_CAPABILITIES, capability)
    )
  ) {
    return deny("MEMBERSHIP_INVALID");
  }
  if (membership.status !== "active") return deny("MEMBERSHIP_INACTIVE");
  if (!isActiveMembershipAt(membership, at)) {
    return deny("MEMBERSHIP_NOT_EFFECTIVE");
  }
  if (!ORGANIZATION_ACTIONS[membership.organizationRole].has(request.action)) {
    return deny("ROLE_FORBIDDEN");
  }

  const visibilityDenial = validateVisibility(request, membership);
  if (visibilityDenial) return visibilityDenial;

  if (!SITE_ACTIONS.has(request.action)) {
    return {
      allowed: true,
      actorId: request.actorId,
      customerId: request.customerId,
      siteId: null,
      membershipId: membership.id,
      organizationRole: membership.organizationRole,
      siteRole: null,
      effectiveTicketScope: narrowestScope(
        membership.ticketVisibilityScope,
        ROLE_MAXIMUM_SCOPE[membership.organizationRole]
      ),
      approverCapabilities: [...membership.approverCapabilities],
    };
  }

  if (!isNonEmpty(request.siteId)) return deny("SITE_REQUIRED");
  if (!site || site.id !== request.siteId) return deny("SITE_NOT_FOUND");
  if (!includesValue(CUSTOMER_SITE_STATUSES, site.status)) {
    return deny("SITE_INVALID");
  }
  if (site.customerId !== request.customerId) {
    return deny("SITE_TENANT_MISMATCH");
  }
  if (requiresActiveSite(request.action) && site.status !== "active") {
    return deny("SITE_INACTIVE_FOR_ACTION");
  }

  const roleMaximumScope = ROLE_MAXIMUM_SCOPE[membership.organizationRole];
  const membershipScope = narrowestScope(
    membership.ticketVisibilityScope,
    roleMaximumScope
  );
  const hasCustomerScope =
    membership.organizationRole === "organization_admin" &&
    membershipScope === "CUSTOMER";

  let effectiveTicketScope = membershipScope;
  let siteRole: SiteAssignmentRole | null = null;

  if (!hasCustomerScope) {
    if (!assignment) return deny("SITE_ASSIGNMENT_REQUIRED");
    if (
      !isUuid(assignment.id) ||
      assignment.membershipId !== membership.id ||
      assignment.customerId !== request.customerId ||
      assignment.siteId !== request.siteId ||
      !includesValue(SITE_ASSIGNMENT_ROLES, assignment.siteRole) ||
      (assignment.objectScope !== null &&
        assignment.objectScope !== "OWN" &&
        assignment.objectScope !== "SITE")
    ) {
      return deny("SITE_ASSIGNMENT_INVALID");
    }
    if (!isEffectiveAt(assignment, at)) {
      return deny("SITE_ASSIGNMENT_NOT_EFFECTIVE");
    }
    if (!SITE_ACTIONS_BY_ROLE[assignment.siteRole].has(request.action)) {
      return deny("SITE_ROLE_FORBIDDEN");
    }
    siteRole = assignment.siteRole;
    effectiveTicketScope = narrowestScope(
      membershipScope,
      assignment.objectScope
    );
  }

  if (
    (request.action === "ticket.read" || request.action === "ticket.comment") &&
    effectiveTicketScope === "OWN" &&
    !request.object?.actorIds?.includes(request.actorId)
  ) {
    return deny("OBJECT_SCOPE_FORBIDDEN");
  }

  return {
    allowed: true,
    actorId: request.actorId,
    customerId: request.customerId,
    siteId: request.siteId,
    membershipId: membership.id,
    organizationRole: membership.organizationRole,
    siteRole,
    effectiveTicketScope,
    approverCapabilities: [...membership.approverCapabilities],
  };
}
