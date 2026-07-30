import { describe, expect, it } from "vitest";
import type { Ticket, TicketStatus } from "@/types/ticket";
import { buildMasterTicketMessage } from "./ticket-master";

function ticketWithStatus(status: TicketStatus): Ticket {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    ticket_no: "RPL-000123",
    customer_id: "22222222-2222-4222-8222-222222222222",
    site_id: "33333333-3333-4333-8333-333333333333",
    source: "slack",
    title: "AMR stopped",
    description: "The unit stopped during a mission.",
    request_type: "incident",
    severity: "P2",
    status,
    asset_id: "AMR-01",
    area: "Line 1",
    impact: "production_slowed",
    owner_id: "44444444-4444-4444-8444-444444444444",
    created_by: "44444444-4444-4444-8444-444444444444",
    customer_visible_summary: null,
    internal_summary: null,
    secure_token: "token",
    created_at: "2026-07-30T12:00:00.000Z",
    updated_at: "2026-07-30T12:00:00.000Z",
    resolved_at: null,
    closed_at: null,
    sla_policy_id: null,
    first_response_due_at: null,
    resolve_due_at: null,
    first_response_at: null,
    first_response_breached_at: null,
    resolution_breached_at: null,
    sla_breached: false,
  };
}

function actionIds(status: TicketStatus): string[] {
  const actionBlock = buildMasterTicketMessage(ticketWithStatus(status)).find(
    (block) => block.type === "actions"
  ) as { elements?: Array<{ action_id?: string }> } | undefined;

  return (
    actionBlock?.elements
      ?.map((element) => element.action_id)
      .filter((value): value is string => Boolean(value)) ?? []
  );
}

describe("Slack ticket master guarded actions", () => {
  it("offers only assignment and non-transition updates on a new ticket", () => {
    expect(actionIds("new")).toEqual([
      "assign_to_me",
      "customer_update",
    ]);
  });

  it("offers legal work actions on an assigned ticket", () => {
    expect(actionIds("assigned")).toEqual([
      "assign_to_me",
      "mark_in_progress",
      "request_info",
      "customer_update",
      "resolve_ticket",
    ]);
  });

  it("removes mutating lifecycle shortcuts from a closed ticket", () => {
    expect(actionIds("closed")).toEqual(["customer_update"]);
  });
});
