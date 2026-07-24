import { describe, it, expect } from "vitest";
import {
  computeSlaTargets,
  computeSLAState,
  isFirstResponseEvent,
  computeSlaBreached,
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

describe("isFirstResponseEvent", () => {
  it("is the first internal comment", () => {
    expect(
      isFirstResponseEvent({
        isInternalComment: true,
        statusChanged: false,
        oldStatus: null,
        newStatus: null,
        hadFirstResponse: false,
      })
    ).toBe(true);
  });

  it("is the first time the status leaves `new`", () => {
    expect(
      isFirstResponseEvent({
        isInternalComment: false,
        statusChanged: true,
        oldStatus: "new",
        newStatus: "in_progress",
        hadFirstResponse: false,
      })
    ).toBe(true);
  });

  it("is NOT a customer comment", () => {
    expect(
      isFirstResponseEvent({
        isInternalComment: false,
        statusChanged: false,
        oldStatus: null,
        newStatus: null,
        hadFirstResponse: false,
      })
    ).toBe(false);
  });

  it("is NOT a second internal comment after the first one", () => {
    expect(
      isFirstResponseEvent({
        isInternalComment: true,
        statusChanged: false,
        oldStatus: null,
        newStatus: null,
        hadFirstResponse: true,
      })
    ).toBe(false);
  });

  it("is NOT a status change that didn't leave `new`", () => {
    expect(
      isFirstResponseEvent({
        isInternalComment: false,
        statusChanged: true,
        oldStatus: "in_progress",
        newStatus: "waiting_customer",
        hadFirstResponse: false,
      })
    ).toBe(false);
  });
});

describe("computeSlaBreached", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const respDue = new Date("2026-07-19T10:15:00.000Z");
  const resoDue = new Date("2026-07-19T18:00:00.000Z");

  it("is not breached if both deadlines are in the future", () => {
    expect(
      computeSlaBreached({
        status: "in_progress",
        first_response_due_at: new Date("2026-07-19T13:00:00.000Z").toISOString(),
        resolve_due_at: new Date("2026-07-19T18:00:00.000Z").toISOString(),
        first_response_at: null,
        now,
      })
    ).toBe(false);
  });

  it("is breached on response when due passes with no first response", () => {
    expect(
      computeSlaBreached({
        status: "new",
        first_response_due_at: respDue.toISOString(),
        resolve_due_at: resoDue.toISOString(),
        first_response_at: null,
        now,
      })
    ).toBe(true);
  });

  it("is NOT breached on response if first_response_at is set", () => {
    expect(
      computeSlaBreached({
        status: "in_progress",
        first_response_due_at: respDue.toISOString(),
        resolve_due_at: resoDue.toISOString(),
        first_response_at: new Date("2026-07-19T10:00:00.000Z").toISOString(),
        now,
      })
    ).toBe(false);
  });

  it("is breached on resolution when resolve due passes and ticket is still open", () => {
    expect(
      computeSlaBreached({
        status: "in_progress",
        first_response_due_at: new Date("2026-07-19T13:00:00.000Z").toISOString(),
        resolve_due_at: new Date("2026-07-19T11:00:00.000Z").toISOString(),
        first_response_at: new Date("2026-07-19T10:00:00.000Z").toISOString(),
        now,
      })
    ).toBe(true);
  });

  it("is NOT breached on resolution once the ticket is resolved", () => {
    expect(
      computeSlaBreached({
        status: "resolved",
        first_response_due_at: new Date("2026-07-19T13:00:00.000Z").toISOString(),
        resolve_due_at: new Date("2026-07-19T11:00:00.000Z").toISOString(),
        first_response_at: new Date("2026-07-19T10:00:00.000Z").toISOString(),
        now,
      })
    ).toBe(false);
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
        sla_breached: false,
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
        sla_breached: false,
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
        sla_breached: true,
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
        sla_breached: true,
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
        sla_breached: false,
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
        sla_breached: true,
      },
      now,
    });
    expect(s.status).toBe("resolution_breached");
  });
});
