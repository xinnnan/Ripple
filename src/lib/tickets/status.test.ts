import { describe, expect, it } from "vitest";
import { TICKET_STATUSES, type TicketStatus } from "@/types/ticket";
import {
  canTransitionTicketStatus,
  getAllowedTicketTransitions,
  ticketStatusAcceptsAssignment,
  ticketStatusRequiresOwner,
  TICKET_STATUS_TRANSITIONS,
} from "./status";

const expectedTransitions: Record<
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

describe("ticket status transition truth table", () => {
  it("matches the documented compatibility state machine exactly", () => {
    expect(TICKET_STATUS_TRANSITIONS).toEqual(expectedTransitions);
  });

  it("accepts every documented next state and rejects every other jump", () => {
    for (const currentStatus of TICKET_STATUSES) {
      for (const nextStatus of TICKET_STATUSES) {
        const expected =
          currentStatus === nextStatus ||
          expectedTransitions[currentStatus].includes(nextStatus);
        expect(
          canTransitionTicketStatus(currentStatus, nextStatus),
          `${currentStatus} -> ${nextStatus}`
        ).toBe(expected);
      }
    }
  });

  it("returns immutable next-state options without including the current state", () => {
    for (const currentStatus of TICKET_STATUSES) {
      expect(getAllowedTicketTransitions(currentStatus)).toEqual(
        expectedTransitions[currentStatus]
      );
      expect(getAllowedTicketTransitions(currentStatus)).not.toContain(
        currentStatus
      );
    }
  });

  it("requires an owner only for active assigned work states", () => {
    expect(ticketStatusRequiresOwner("assigned")).toBe(true);
    expect(ticketStatusRequiresOwner("in_progress")).toBe(true);
    for (const status of TICKET_STATUSES.filter(
      (value) => value !== "assigned" && value !== "in_progress"
    )) {
      expect(ticketStatusRequiresOwner(status)).toBe(false);
    }
  });

  it("does not offer assignment on terminal states", () => {
    expect(ticketStatusAcceptsAssignment("resolved")).toBe(false);
    expect(ticketStatusAcceptsAssignment("closed")).toBe(false);
    for (const status of TICKET_STATUSES.filter(
      (value) => value !== "resolved" && value !== "closed"
    )) {
      expect(ticketStatusAcceptsAssignment(status)).toBe(true);
    }
  });
});
