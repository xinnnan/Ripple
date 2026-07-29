import { describe, it, expect } from "vitest";
import {
  computeSlaTargets,
  computeSLAState,
  isFirstHumanCustomerVisibleResponse,
  isMilestoneLate,
  addMinutes,
  getResponseMinutes,
  getResolutionMinutes,
  type SLAPolicy,
} from "./sla";

const POLICY: SLAPolicy = {
  id: "policy-1",
  name: "Test SLA",
  customer_id: null,
  is_default: true,
  p1_response_minutes: 15,
  p1_resolution_minutes: 240,
  p2_response_minutes: 60,
  p2_resolution_minutes: 480,
  p3_response_minutes: 240,
  p3_resolution_minutes: 1440,
  p4_response_minutes: 1440,
  p4_resolution_minutes: 4320,
};

describe("getResponseMinutes / getResolutionMinutes", () => {
  it("returns the per-severity minutes from the policy", () => {
    expect(getResponseMinutes(POLICY, "P1")).toBe(15);
    expect(getResponseMinutes(POLICY, "P2")).toBe(60);
    expect(getResponseMinutes(POLICY, "P3")).toBe(240);
    expect(getResponseMinutes(POLICY, "P4")).toBe(1440);
    expect(getResolutionMinutes(POLICY, "P1")).toBe(240);
    expect(getResolutionMinutes(POLICY, "P4")).toBe(4320);
  });
});

describe("addMinutes", () => {
  it("adds the right number of milliseconds", () => {
    const d = new Date("2026-07-19T10:00:00.000Z");
    expect(addMinutes(d, 15).toISOString()).toBe("2026-07-19T10:15:00.000Z");
    expect(addMinutes(d, 0).getTime()).toBe(d.getTime());
    expect(addMinutes(d, 60).toISOString()).toBe("2026-07-19T11:00:00.000Z");
  });
});

describe("computeSlaTargets", () => {
  it("computes both due times from the policy + severity", () => {
    const created = new Date("2026-07-19T10:00:00.000Z");
    const t = computeSlaTargets({ policy: POLICY, severity: "P1", createdAt: created });
    expect(t.policyId).toBe("policy-1");
    expect(t.responseDueAt?.toISOString()).toBe("2026-07-19T10:15:00.000Z");
    expect(t.resolveDueAt?.toISOString()).toBe("2026-07-19T14:00:00.000Z");
  });

  it("uses the P3 targets for P3", () => {
    const created = new Date("2026-07-19T10:00:00.000Z");
    const t = computeSlaTargets({ policy: POLICY, severity: "P3", createdAt: created });
    expect(t.responseDueAt?.toISOString()).toBe("2026-07-19T14:00:00.000Z");
    expect(t.resolveDueAt?.toISOString()).toBe("2026-07-20T10:00:00.000Z");
  });
});

describe("first-response truth table", () => {
  const cases = [
    {
      name: "admin human customer-visible response",
      args: {
        authorRole: "admin",
        visibility: "customer",
        isAutomated: false,
        alreadyAchieved: false,
      },
      qualifies: true,
    },
    {
      name: "engineer human customer-visible response",
      args: {
        authorRole: "engineer",
        visibility: "customer",
        isAutomated: false,
        alreadyAchieved: false,
      },
      qualifies: true,
    },
    {
      name: "internal-only engineer note",
      args: {
        authorRole: "engineer",
        visibility: "internal",
        isAutomated: false,
        alreadyAchieved: false,
      },
      qualifies: false,
    },
    {
      name: "customer reply",
      args: {
        authorRole: "customer",
        visibility: "customer",
        isAutomated: false,
        alreadyAchieved: false,
      },
      qualifies: false,
    },
    {
      name: "customer manager reply",
      args: {
        authorRole: "customer_manager",
        visibility: "customer",
        isAutomated: false,
        alreadyAchieved: false,
      },
      qualifies: false,
    },
    {
      name: "automated engineer acknowledgement",
      args: {
        authorRole: "engineer",
        visibility: "customer",
        isAutomated: true,
        alreadyAchieved: false,
      },
      qualifies: false,
    },
    {
      name: "second customer-visible engineer response",
      args: {
        authorRole: "engineer",
        visibility: "customer",
        isAutomated: false,
        alreadyAchieved: true,
      },
      qualifies: false,
    },
  ] as const;

  it.each(cases)("$name => $qualifies", ({ args, qualifies }) => {
    expect(isFirstHumanCustomerVisibleResponse(args)).toBe(qualifies);
  });

  it("does not have a status-change input, so assignment cannot qualify", () => {
    expect(isFirstHumanCustomerVisibleResponse).toHaveLength(1);
  });
});

describe("milestone completion truth table", () => {
  const dueAt = "2026-07-19T12:00:00.000Z";

  it.each([
    ["before due", "2026-07-19T11:59:59.999Z", false],
    ["exactly at due", dueAt, false],
    ["after due", "2026-07-19T12:00:00.001Z", true],
  ])("%s", (_name, achievedAt, breached) => {
    expect(isMilestoneLate({ dueAt, achievedAt })).toBe(breached);
  });

  it("does not invent a breach without both timestamps", () => {
    expect(isMilestoneLate({ dueAt: null, achievedAt: dueAt })).toBe(false);
    expect(isMilestoneLate({ dueAt, achievedAt: null })).toBe(false);
  });
});

describe("computeSLAState", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");

  it("returns not_applicable when no policy columns are set", () => {
    const s = computeSLAState({
      ticket: {
        severity: "P1",
        status: "new",
        first_response_due_at: null,
        resolve_due_at: null,
        first_response_at: null,
        resolved_at: null,
        first_response_breached_at: null,
        resolution_breached_at: null,
      },
      now,
    });
    expect(s.status).toBe("not_applicable");
    expect(s.earliestDueAt).toBeNull();
  });

  it("returns on_track when both windows are in the future", () => {
    const s = computeSLAState({
      ticket: {
        severity: "P1",
        status: "new",
        first_response_due_at: new Date("2026-07-19T12:15:00.000Z").toISOString(),
        resolve_due_at: new Date("2026-07-19T18:00:00.000Z").toISOString(),
        first_response_at: null,
        resolved_at: null,
        first_response_breached_at: null,
        resolution_breached_at: null,
      },
      now,
    });
    expect(s.status).toBe("on_track");
    expect(s.responseDeltaMinutes).toBeGreaterThan(0);
    expect(s.resolutionDeltaMinutes).toBeGreaterThan(0);
    expect(s.earliestDueAt?.toISOString()).toBe("2026-07-19T12:15:00.000Z");
  });

  it("returns response_breached when response window is past and no response", () => {
    const s = computeSLAState({
      ticket: {
        severity: "P1",
        status: "in_progress",
        first_response_due_at: new Date("2026-07-19T10:00:00.000Z").toISOString(),
        resolve_due_at: new Date("2026-07-19T18:00:00.000Z").toISOString(),
        first_response_at: null,
        resolved_at: null,
        first_response_breached_at: new Date("2026-07-19T10:00:00.000Z").toISOString(),
        resolution_breached_at: null,
      },
      now,
    });
    expect(s.status).toBe("response_breached");
    expect(s.responseDeltaMinutes).toBeLessThan(0);
  });

  it("returns resolution_breached when resolve window is past", () => {
    const s = computeSLAState({
      ticket: {
        severity: "P1",
        status: "in_progress",
        first_response_due_at: new Date("2026-07-19T10:00:00.000Z").toISOString(),
        resolve_due_at: new Date("2026-07-19T11:00:00.000Z").toISOString(),
        first_response_at: new Date("2026-07-19T09:30:00.000Z").toISOString(),
        resolved_at: null,
        first_response_breached_at: null,
        resolution_breached_at: new Date("2026-07-19T11:00:00.000Z").toISOString(),
      },
      now,
    });
    expect(s.status).toBe("resolution_breached");
  });

  it("returns met when the ticket is resolved and sla_breached is false", () => {
    const s = computeSLAState({
      ticket: {
        severity: "P1",
        status: "resolved",
        first_response_due_at: new Date("2026-07-19T10:00:00.000Z").toISOString(),
        resolve_due_at: new Date("2026-07-19T18:00:00.000Z").toISOString(),
        first_response_at: new Date("2026-07-19T09:30:00.000Z").toISOString(),
        resolved_at: new Date("2026-07-19T17:00:00.000Z").toISOString(),
        first_response_breached_at: null,
        resolution_breached_at: null,
      },
      now,
    });
    expect(s.status).toBe("met");
  });

  it("returns resolution_breached on a closed ticket that breached", () => {
    const s = computeSLAState({
      ticket: {
        severity: "P1",
        status: "closed",
        first_response_due_at: new Date("2026-07-19T10:00:00.000Z").toISOString(),
        resolve_due_at: new Date("2026-07-19T11:00:00.000Z").toISOString(),
        first_response_at: null,
        resolved_at: new Date("2026-07-19T12:00:00.000Z").toISOString(),
        first_response_breached_at: new Date("2026-07-19T10:00:00.000Z").toISOString(),
        resolution_breached_at: new Date("2026-07-19T11:00:00.000Z").toISOString(),
      },
      now,
    });
    expect(s.status).toBe("resolution_breached");
  });

  it("persists a late resolution as breached using resolved_at", () => {
    const s = computeSLAState({
      ticket: {
        severity: "P1",
        status: "resolved",
        first_response_due_at: new Date("2026-07-19T10:00:00.000Z").toISOString(),
        resolve_due_at: new Date("2026-07-19T11:00:00.000Z").toISOString(),
        first_response_at: new Date("2026-07-19T09:30:00.000Z").toISOString(),
        resolved_at: new Date("2026-07-19T11:01:00.000Z").toISOString(),
        first_response_breached_at: null,
        resolution_breached_at: new Date("2026-07-19T11:00:00.000Z").toISOString(),
      },
      now,
    });
    expect(s.status).toBe("resolution_breached");
    expect(s.resolutionDeltaMinutes).toBe(-1);
  });

  it("keeps first-response and resolution outcomes independent", () => {
    const s = computeSLAState({
      ticket: {
        severity: "P1",
        status: "resolved",
        first_response_due_at: new Date("2026-07-19T10:00:00.000Z").toISOString(),
        resolve_due_at: new Date("2026-07-19T18:00:00.000Z").toISOString(),
        first_response_at: new Date("2026-07-19T10:01:00.000Z").toISOString(),
        resolved_at: new Date("2026-07-19T17:00:00.000Z").toISOString(),
        first_response_breached_at: new Date("2026-07-19T10:00:00.000Z").toISOString(),
        resolution_breached_at: null,
      },
      now,
    });
    expect(s.status).toBe("response_breached");
    expect(s.responseDeltaMinutes).toBe(-1);
  });

  it("never reports closed without a resolution timestamp as met", () => {
    const s = computeSLAState({
      ticket: {
        severity: "P1",
        status: "closed",
        first_response_due_at: new Date("2026-07-19T10:00:00.000Z").toISOString(),
        resolve_due_at: new Date("2026-07-19T18:00:00.000Z").toISOString(),
        first_response_at: new Date("2026-07-19T09:30:00.000Z").toISOString(),
        resolved_at: null,
        first_response_breached_at: null,
        resolution_breached_at: null,
      },
      now,
    });
    expect(s.status).toBe("resolution_breached");
  });
});
