import { describe, expect, it } from "vitest";
import {
  APPROVER_CAPABILITIES,
  CUSTOMER_MEMBERSHIP_STATUSES,
  isActiveMembershipAt,
  isEffectiveAt,
  ORGANIZATION_ROLES,
  SITE_ASSIGNMENT_ROLES,
  TICKET_VISIBILITY_SCOPES,
} from "./model";

describe("authorization foundation model", () => {
  it("keeps the PRD role, scope, lifecycle, and approval vocabularies explicit", () => {
    expect(ORGANIZATION_ROLES).toEqual([
      "organization_admin",
      "site_admin",
      "requester",
      "viewer",
    ]);
    expect(SITE_ASSIGNMENT_ROLES).toEqual([
      "site_admin",
      "requester",
      "viewer",
    ]);
    expect(TICKET_VISIBILITY_SCOPES).toEqual(["OWN", "SITE", "CUSTOMER"]);
    expect(CUSTOMER_MEMBERSHIP_STATUSES).toEqual([
      "invited",
      "active",
      "suspended",
      "revoked",
    ]);
    expect(APPROVER_CAPABILITIES).toEqual([
      "onsite_appointment",
      "paid_service",
      "paid_parts",
      "out_of_scope_work",
    ]);
  });

  it("uses a start-inclusive and end-exclusive effective window", () => {
    const window = {
      effectiveFrom: "2026-08-17T12:00:00.000Z",
      effectiveTo: "2026-08-17T13:00:00.000Z",
    };

    expect(isEffectiveAt(window, new Date("2026-08-17T11:59:59.999Z"))).toBe(
      false
    );
    expect(isEffectiveAt(window, new Date("2026-08-17T12:00:00.000Z"))).toBe(
      true
    );
    expect(isEffectiveAt(window, new Date("2026-08-17T12:59:59.999Z"))).toBe(
      true
    );
    expect(isEffectiveAt(window, new Date("2026-08-17T13:00:00.000Z"))).toBe(
      false
    );
  });

  it("allows an open-ended window and fails closed on invalid timestamps", () => {
    expect(
      isEffectiveAt(
        {
          effectiveFrom: "2026-08-17T12:00:00.000Z",
          effectiveTo: null,
        },
        new Date("2030-01-01T00:00:00.000Z")
      )
    ).toBe(true);
    expect(
      isEffectiveAt(
        { effectiveFrom: "invalid", effectiveTo: null },
        new Date("2026-08-17T12:00:00.000Z")
      )
    ).toBe(false);
    expect(
      isEffectiveAt(
        {
          effectiveFrom: "2026-08-17T12:00:00.000Z",
          effectiveTo: "invalid",
        },
        new Date("2026-08-17T12:00:00.000Z")
      )
    ).toBe(false);
    expect(
      isEffectiveAt(
        { effectiveFrom: "2026-08-17T12:00:00.000Z", effectiveTo: null },
        new Date("invalid")
      )
    ).toBe(false);
  });

  it("requires both active lifecycle state and an effective time window", () => {
    const membership = {
      status: "active" as const,
      effectiveFrom: "2026-08-17T12:00:00.000Z",
      effectiveTo: null,
    };

    expect(
      isActiveMembershipAt(
        membership,
        new Date("2026-08-17T12:00:00.000Z")
      )
    ).toBe(true);
    expect(
      isActiveMembershipAt(
        { ...membership, status: "suspended" },
        new Date("2026-08-17T12:00:00.000Z")
      )
    ).toBe(false);
  });
});
