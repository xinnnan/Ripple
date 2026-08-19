import { describe, expect, it } from "vitest";
import {
  CUSTOMER_POLICY_ACTIONS,
  evaluateCustomerPolicy,
  type CustomerPolicyAction,
  type CustomerPolicyInput,
} from "./policy";
import type {
  OrganizationRole,
  SiteAssignmentRole,
  TicketVisibilityScope,
} from "./model";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const SITE_ID = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";
const ASSIGNMENT_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-08-19T12:00:00.000Z");

function objectForAction(action: CustomerPolicyAction) {
  if (action === "approval.decide") {
    return {
      visibility: "APPROVER_ONLY" as const,
      requiredApproverCapability: "paid_parts" as const,
    };
  }
  if (action === "ticket.read" || action === "ticket.comment") {
    return {
      visibility: "CUSTOMER_VISIBLE" as const,
      actorIds: [ACTOR_ID],
    };
  }
  return undefined;
}

function makeInput(
  action: CustomerPolicyAction = "ticket.read",
  options: {
    organizationRole?: OrganizationRole;
    membershipScope?: TicketVisibilityScope;
    siteRole?: SiteAssignmentRole;
  } = {}
): CustomerPolicyInput {
  const organizationRole = options.organizationRole ?? "organization_admin";
  const membershipScope =
    options.membershipScope ??
    (organizationRole === "organization_admin" ? "CUSTOMER" : "SITE");
  const siteRole =
    options.siteRole ??
    (organizationRole === "viewer"
      ? "viewer"
      : organizationRole === "requester"
        ? "requester"
        : "site_admin");

  return {
    request: {
      actorId: ACTOR_ID,
      customerId: CUSTOMER_ID,
      siteId:
        action === "customer.read" || action === "customer.manage"
          ? null
          : SITE_ID,
      action,
      object: objectForAction(action),
    },
    actor: { id: ACTOR_ID, status: "active" },
    customer: { id: CUSTOMER_ID, status: "active" },
    membership: {
      id: MEMBERSHIP_ID,
      userId: ACTOR_ID,
      customerId: CUSTOMER_ID,
      organizationRole,
      status: "active",
      ticketVisibilityScope: membershipScope,
      approverCapabilities: ["paid_parts"],
      effectiveFrom: "2026-08-19T11:00:00.000Z",
      effectiveTo: null,
    },
    site: { id: SITE_ID, customerId: CUSTOMER_ID, status: "active" },
    assignment: {
      id: ASSIGNMENT_ID,
      membershipId: MEMBERSHIP_ID,
      customerId: CUSTOMER_ID,
      siteId: SITE_ID,
      siteRole,
      objectScope: null,
      effectiveFrom: "2026-08-19T11:00:00.000Z",
      effectiveTo: null,
    },
    at: NOW,
  };
}

function expectDenied(input: CustomerPolicyInput, reason: string) {
  expect(evaluateCustomerPolicy(input)).toEqual({ allowed: false, reason });
}

describe("customer authorization policy", () => {
  it("executes the complete organization-role and action capability matrix", () => {
    const allowedByRole: Record<OrganizationRole, CustomerPolicyAction[]> = {
      organization_admin: [...CUSTOMER_POLICY_ACTIONS],
      site_admin: CUSTOMER_POLICY_ACTIONS.filter(
        (action) => action !== "customer.manage"
      ),
      requester: CUSTOMER_POLICY_ACTIONS.filter(
        (action) => action !== "customer.manage" && action !== "site.manage"
      ),
      viewer: ["customer.read", "site.read", "ticket.read"],
    };

    for (const organizationRole of Object.keys(
      allowedByRole
    ) as OrganizationRole[]) {
      for (const action of CUSTOMER_POLICY_ACTIONS) {
        const decision = evaluateCustomerPolicy(
          makeInput(action, { organizationRole })
        );
        expect(decision.allowed, `${organizationRole} ${action}`).toBe(
          allowedByRole[organizationRole].includes(action)
        );
      }
    }
  });

  it("requires a real active actor and matching active/trial customer", () => {
    expectDenied({ ...makeInput(), actor: null }, "ACTOR_NOT_FOUND");
    expectDenied(
      { ...makeInput(), actor: { id: "other", status: "active" } },
      "ACTOR_NOT_FOUND"
    );
    expectDenied(
      { ...makeInput(), actor: { id: ACTOR_ID, status: "inactive" } },
      "ACTOR_INACTIVE"
    );
    expectDenied({ ...makeInput(), customer: null }, "CUSTOMER_NOT_FOUND");
    expectDenied(
      {
        ...makeInput(),
        customer: { id: CUSTOMER_ID, status: "inactive" },
      },
      "CUSTOMER_INACTIVE"
    );
    expect(
      evaluateCustomerPolicy({
        ...makeInput(),
        customer: { id: CUSTOMER_ID, status: "trial" },
      }).allowed
    ).toBe(true);
  });

  it("requires one matching active membership", () => {
    expectDenied({ ...makeInput(), membership: null }, "MEMBERSHIP_NOT_FOUND");
    expectDenied(
      {
        ...makeInput(),
        membership: { ...makeInput().membership!, customerId: "other" },
      },
      "MEMBERSHIP_NOT_FOUND"
    );
    for (const status of ["invited", "suspended", "revoked"] as const) {
      expectDenied(
        {
          ...makeInput(),
          membership: { ...makeInput().membership!, status },
        },
        "MEMBERSHIP_INACTIVE"
      );
    }
  });

  it("uses start-inclusive and end-exclusive membership timing", () => {
    const base = makeInput();
    const membership = {
      ...base.membership!,
      effectiveFrom: "2026-08-19T12:00:00.000Z",
      effectiveTo: "2026-08-19T13:00:00.000Z",
    };
    expect(
      evaluateCustomerPolicy({ ...base, membership, at: new Date(membership.effectiveFrom) })
        .allowed
    ).toBe(true);
    expectDenied(
      {
        ...base,
        membership,
        at: new Date("2026-08-19T11:59:59.999Z"),
      },
      "MEMBERSHIP_NOT_EFFECTIVE"
    );
    expectDenied(
      { ...base, membership, at: new Date(membership.effectiveTo) },
      "MEMBERSHIP_NOT_EFFECTIVE"
    );
  });

  it("allows inactive-site history reads but blocks new activity", () => {
    const inactiveSite = {
      ...makeInput().site!,
      status: "decommissioned",
    };
    expect(
      evaluateCustomerPolicy({ ...makeInput("ticket.read"), site: inactiveSite })
        .allowed
    ).toBe(true);
    expect(
      evaluateCustomerPolicy({ ...makeInput("site.read"), site: inactiveSite })
        .allowed
    ).toBe(true);
    for (const action of [
      "site.manage",
      "ticket.create",
      "ticket.comment",
      "approval.decide",
    ] as const) {
      expectDenied(
        { ...makeInput(action), site: inactiveSite },
        "SITE_INACTIVE_FOR_ACTION"
      );
    }
  });

  it("requires a site and keeps the site inside the selected customer", () => {
    expectDenied(
      {
        ...makeInput(),
        request: { ...makeInput().request, siteId: null },
      },
      "SITE_REQUIRED"
    );
    expectDenied({ ...makeInput(), site: null }, "SITE_NOT_FOUND");
    expectDenied(
      { ...makeInput(), site: { ...makeInput().site!, status: "unknown" } },
      "SITE_INVALID"
    );
    expectDenied(
      {
        ...makeInput(),
        site: { ...makeInput().site!, customerId: "other" },
      },
      "SITE_TENANT_MISMATCH"
    );
  });

  it("lets only an organization admin with effective CUSTOMER scope bypass assignments", () => {
    expect(
      evaluateCustomerPolicy({ ...makeInput(), assignment: null }).allowed
    ).toBe(true);

    for (const organizationRole of [
      "site_admin",
      "requester",
      "viewer",
    ] as const) {
      expectDenied(
        {
          ...makeInput("ticket.read", {
            organizationRole,
            membershipScope: "CUSTOMER",
          }),
          assignment: null,
        },
        "SITE_ASSIGNMENT_REQUIRED"
      );
    }

    expectDenied(
      {
        ...makeInput("ticket.read", {
          organizationRole: "organization_admin",
          membershipScope: "SITE",
        }),
        assignment: null,
      },
      "SITE_ASSIGNMENT_REQUIRED"
    );
  });

  it("requires a matching effective tenant-bound site assignment", () => {
    const base = makeInput("ticket.read", {
      organizationRole: "requester",
    });
    expectDenied({ ...base, assignment: null }, "SITE_ASSIGNMENT_REQUIRED");
    expectDenied(
      {
        ...base,
        assignment: { ...base.assignment!, customerId: "other" },
      },
      "SITE_ASSIGNMENT_INVALID"
    );
    expectDenied(
      {
        ...base,
        assignment: {
          ...base.assignment!,
          effectiveTo: "2026-08-19T12:00:00.000Z",
        },
      },
      "SITE_ASSIGNMENT_NOT_EFFECTIVE"
    );
  });

  it("intersects organization and site roles without widening writes", () => {
    const requesterAtViewerSite = makeInput("ticket.create", {
      organizationRole: "requester",
      siteRole: "viewer",
    });
    expectDenied(requesterAtViewerSite, "SITE_ROLE_FORBIDDEN");

    const viewerAtAdminSite = makeInput("ticket.create", {
      organizationRole: "viewer",
      siteRole: "site_admin",
    });
    expectDenied(viewerAtAdminSite, "ROLE_FORBIDDEN");
  });

  it("executes the complete site-role and site-action matrix", () => {
    const siteActions = CUSTOMER_POLICY_ACTIONS.filter(
      (action) => action !== "customer.read" && action !== "customer.manage"
    );
    const allowedBySiteRole: Record<
      SiteAssignmentRole,
      CustomerPolicyAction[]
    > = {
      site_admin: [...siteActions],
      requester: siteActions.filter((action) => action !== "site.manage"),
      viewer: ["site.read", "ticket.read"],
    };

    for (const siteRole of Object.keys(
      allowedBySiteRole
    ) as SiteAssignmentRole[]) {
      for (const action of siteActions) {
        const decision = evaluateCustomerPolicy(
          makeInput(action, {
            organizationRole: "organization_admin",
            membershipScope: "SITE",
            siteRole,
          })
        );
        expect(decision.allowed, `${siteRole} ${action}`).toBe(
          allowedBySiteRole[siteRole].includes(action)
        );
      }
    }
  });

  it("executes every role, membership-scope, and assignment-override intersection", () => {
    const scopeRank: Record<TicketVisibilityScope, number> = {
      OWN: 0,
      SITE: 1,
      CUSTOMER: 2,
    };
    const roleMaximum: Record<OrganizationRole, TicketVisibilityScope> = {
      organization_admin: "CUSTOMER",
      site_admin: "SITE",
      requester: "SITE",
      viewer: "SITE",
    };
    const scopes = ["OWN", "SITE", "CUSTOMER"] as const;
    const overrides = [null, "OWN", "SITE"] as const;

    for (const organizationRole of Object.keys(
      roleMaximum
    ) as OrganizationRole[]) {
      for (const membershipScope of scopes) {
        for (const objectScope of overrides) {
          const input = makeInput("ticket.read", {
            organizationRole,
            membershipScope,
          });
          input.assignment = { ...input.assignment!, objectScope };
          const decision = evaluateCustomerPolicy(input);
          expect(decision.allowed).toBe(true);
          if (!decision.allowed) continue;

          const candidates = [membershipScope, roleMaximum[organizationRole]];
          const customerBypass =
            organizationRole === "organization_admin" &&
            membershipScope === "CUSTOMER";
          if (!customerBypass && objectScope) candidates.push(objectScope);
          const expectedScope = candidates.reduce((narrowest, scope) =>
            scopeRank[scope] < scopeRank[narrowest] ? scope : narrowest
          );
          expect(
            decision.effectiveTicketScope,
            `${organizationRole}/${membershipScope}/${objectScope}`
          ).toBe(expectedScope);
        }
      }
    }
  });

  it("intersects membership and assignment object scopes", () => {
    const requester = makeInput("ticket.read", {
      organizationRole: "requester",
    });
    const ownAssignment = {
      ...requester.assignment!,
      objectScope: "OWN" as const,
    };
    expectDenied(
      {
        ...requester,
        assignment: ownAssignment,
        request: {
          ...requester.request,
          object: { visibility: "CUSTOMER_VISIBLE", actorIds: [] },
        },
      },
      "OBJECT_SCOPE_FORBIDDEN"
    );
    const sharedDecision = evaluateCustomerPolicy({
      ...requester,
      assignment: ownAssignment,
      request: {
        ...requester.request,
        object: { visibility: "CUSTOMER_VISIBLE", actorIds: [ACTOR_ID] },
      },
    });
    expect(sharedDecision).toMatchObject({
      allowed: true,
      effectiveTicketScope: "OWN",
    });

    const ownMembership = makeInput("ticket.read", {
      organizationRole: "requester",
      membershipScope: "OWN",
    });
    expectDenied(
      {
        ...ownMembership,
        request: {
          ...ownMembership.request,
          object: { visibility: "CUSTOMER_VISIBLE", actorIds: [] },
        },
      },
      "OBJECT_SCOPE_FORBIDDEN"
    );
  });

  it("allows ticket creation under OWN scope because the actor becomes its owner", () => {
    const decision = evaluateCustomerPolicy(
      makeInput("ticket.create", {
        organizationRole: "requester",
        membershipScope: "OWN",
      })
    );
    expect(decision).toMatchObject({
      allowed: true,
      effectiveTicketScope: "OWN",
    });
  });

  it("enforces content visibility before object scope", () => {
    for (const visibility of [
      "INTERNAL_ONLY",
      "RESTRICTED_INTERNAL",
    ] as const) {
      const base = makeInput();
      expectDenied(
        {
          ...base,
          request: {
            ...base.request,
            object: { visibility, actorIds: [ACTOR_ID] },
          },
        },
        "VISIBILITY_FORBIDDEN"
      );
    }
    const missing = makeInput();
    expectDenied(
      { ...missing, request: { ...missing.request, object: undefined } },
      "VISIBILITY_REQUIRED"
    );
  });

  it("requires the exact stacked approver capability and rejects viewer approval", () => {
    const approval = makeInput("approval.decide", {
      organizationRole: "requester",
    });
    expect(evaluateCustomerPolicy(approval).allowed).toBe(true);
    expectDenied(
      {
        ...approval,
        membership: { ...approval.membership!, approverCapabilities: [] },
      },
      "APPROVER_CAPABILITY_REQUIRED"
    );
    expectDenied(
      makeInput("approval.decide", {
        organizationRole: "viewer",
        siteRole: "viewer",
      }),
      "ROLE_FORBIDDEN"
    );
  });

  it("fails closed on invalid requests and malformed persisted vocabularies", () => {
    const base = makeInput();
    expectDenied(
      {
        ...base,
        request: { ...base.request, actorId: " " },
      },
      "INVALID_REQUEST"
    );
    expectDenied(
      {
        ...base,
        request: { ...base.request, siteId: "not-a-uuid" },
      },
      "INVALID_REQUEST"
    );
    expectDenied(
      {
        ...base,
        request: {
          ...base.request,
          object: {
            visibility: "CUSTOMER_VISIBLE",
            actorIds: ["not-a-uuid"],
          },
        },
      },
      "INVALID_REQUEST"
    );
    expectDenied(
      { ...base, at: new Date("invalid") },
      "INVALID_REQUEST"
    );
    expectDenied(
      {
        ...base,
        membership: {
          ...base.membership!,
          organizationRole: "root" as OrganizationRole,
        },
      },
      "MEMBERSHIP_INVALID"
    );
    expectDenied(
      {
        ...base,
        membership: {
          ...base.membership!,
          approverCapabilities: ["paid_parts", "paid_parts"],
        },
      },
      "MEMBERSHIP_INVALID"
    );
    const requester = makeInput("ticket.read", {
      organizationRole: "requester",
    });
    expectDenied(
      {
        ...requester,
        assignment: {
          ...requester.assignment!,
          objectScope: "CUSTOMER" as "SITE",
        },
      },
      "SITE_ASSIGNMENT_INVALID"
    );
    expectDenied(
      {
        ...requester,
        assignment: { ...requester.assignment!, id: "invalid" },
      },
      "SITE_ASSIGNMENT_INVALID"
    );
  });

  it("preserves migration 055 compatibility while keeping viewers read-only", () => {
    const legacyManager = makeInput("ticket.read", {
      organizationRole: "organization_admin",
      membershipScope: "CUSTOMER",
    });
    expect(
      evaluateCustomerPolicy({ ...legacyManager, assignment: null })
    ).toMatchObject({ allowed: true, effectiveTicketScope: "CUSTOMER" });

    const legacyMember = makeInput("ticket.read", {
      organizationRole: "requester",
      membershipScope: "SITE",
      siteRole: "requester",
    });
    expect(
      evaluateCustomerPolicy({
        ...legacyMember,
        request: {
          ...legacyMember.request,
          object: { visibility: "CUSTOMER_VISIBLE", actorIds: [] },
        },
      })
    ).toMatchObject({ allowed: true, effectiveTicketScope: "SITE" });

    const legacyViewer = makeInput("ticket.read", {
      organizationRole: "viewer",
      membershipScope: "SITE",
      siteRole: "viewer",
    });
    expect(evaluateCustomerPolicy(legacyViewer).allowed).toBe(true);
    expectDenied(
      makeInput("ticket.comment", {
        organizationRole: "viewer",
        membershipScope: "SITE",
        siteRole: "viewer",
      }),
      "ROLE_FORBIDDEN"
    );
  });
});
