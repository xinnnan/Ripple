import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TicketStatus } from "@/types/ticket";
import {
  notifyTicketMutation,
  type NotificationTicket,
} from "./notifications";

function ticketWithStatus(
  status: TicketStatus,
  submitterEmail: string | null = "operator@example.com"
): NotificationTicket {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    ticket_no: "RPL-000123",
    customer_id: "22222222-2222-4222-8222-222222222222",
    site_id: "33333333-3333-4333-8333-333333333333",
    source: "web",
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
    customer_visible_summary: "Controller restarted and missions resumed.",
    internal_summary: null,
    secure_token: "secure-token",
    created_at: "2026-07-30T12:00:00.000Z",
    updated_at: "2026-07-30T13:00:00.000Z",
    resolved_at:
      status === "resolved" ? "2026-07-30T13:00:00.000Z" : null,
    closed_at: null,
    sla_policy_id: null,
    first_response_due_at: null,
    resolve_due_at: null,
    first_response_at: null,
    first_response_breached_at: null,
    resolution_breached_at: null,
    sla_breached: false,
    submitter_email: submitterEmail,
  };
}

function dependencies() {
  return {
    updateMasterMessage: vi.fn().mockResolvedValue({ ok: true }),
    postMasterThreadReply: vi.fn().mockResolvedValue({ ok: true }),
    sendTicketResolved: vi.fn().mockResolvedValue({
      sent: true,
      id: "email-1",
    }),
  };
}

describe("ticket mutation notification parity", () => {
  it("updates only the master card for a non-resolution mutation", async () => {
    const deps = dependencies();
    const ticket = ticketWithStatus("in_progress");

    await expect(
      notifyTicketMutation(
        { previousStatus: "assigned", ticket },
        deps
      )
    ).resolves.toEqual({
      masterSync: { ok: true },
      resolutionThread: null,
      resolutionEmail: null,
    });

    expect(deps.updateMasterMessage).toHaveBeenCalledWith(ticket, {});
    expect(deps.postMasterThreadReply).not.toHaveBeenCalled();
    expect(deps.sendTicketResolved).not.toHaveBeenCalled();
  });

  it("sends the same Slack thread and email effects for a new resolution", async () => {
    const deps = dependencies();
    const ticket = ticketWithStatus("resolved");
    const slackOptions = {
      channelId: "C123",
      messageTs: "123.456",
    };

    await notifyTicketMutation(
      {
        previousStatus: "in_progress",
        ticket,
        slackOptions,
      },
      deps
    );

    expect(deps.updateMasterMessage).toHaveBeenCalledWith(
      ticket,
      slackOptions
    );
    expect(deps.postMasterThreadReply).toHaveBeenCalledWith(
      ticket,
      "✅ Ticket Resolved\n\nController restarted and missions resumed.",
      slackOptions
    );
    expect(deps.sendTicketResolved).toHaveBeenCalledWith({
      to: "operator@example.com",
      ticketNo: "RPL-000123",
      title: "AMR stopped",
      secureToken: "secure-token",
      resolutionSummary: "Controller restarted and missions resumed.",
    });
  });

  it("still posts the Slack resolution when no submitter email exists", async () => {
    const deps = dependencies();

    const result = await notifyTicketMutation(
      {
        previousStatus: "in_progress",
        ticket: ticketWithStatus("resolved", null),
      },
      deps
    );

    expect(result.resolutionThread).toEqual({ ok: true });
    expect(result.resolutionEmail).toBeNull();
    expect(deps.postMasterThreadReply).toHaveBeenCalledOnce();
    expect(deps.sendTicketResolved).not.toHaveBeenCalled();
  });

  it("does not duplicate resolution notices for a resolved-to-resolved edit", async () => {
    const deps = dependencies();

    await notifyTicketMutation(
      {
        previousStatus: "resolved",
        ticket: ticketWithStatus("resolved"),
      },
      deps
    );

    expect(deps.updateMasterMessage).toHaveBeenCalledOnce();
    expect(deps.postMasterThreadReply).not.toHaveBeenCalled();
    expect(deps.sendTicketResolved).not.toHaveBeenCalled();
  });

  it("returns structured delivery failures without rejecting the mutation flow", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deps = {
      updateMasterMessage: vi.fn().mockResolvedValue({
        ok: false,
        reason: "slack_error" as const,
        error: "channel archived",
      }),
      postMasterThreadReply: vi.fn().mockResolvedValue({
        ok: false,
        reason: "no_message" as const,
      }),
      sendTicketResolved: vi.fn().mockResolvedValue({
        sent: false as const,
        reason: "send_failed" as const,
        error: "domain not verified",
      }),
    };

    await expect(
      notifyTicketMutation(
        {
          previousStatus: "in_progress",
          ticket: ticketWithStatus("resolved"),
        },
        deps
      )
    ).resolves.toEqual({
      masterSync: {
        ok: false,
        reason: "slack_error",
        error: "channel archived",
      },
      resolutionThread: { ok: false, reason: "no_message" },
      resolutionEmail: {
        sent: false,
        reason: "send_failed",
        error: "domain not verified",
      },
    });

    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("keeps both web and Slack mutation paths on the shared dispatcher", () => {
    const webRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/tickets/[ticketId]/route.ts"),
      "utf8"
    );
    const slackActions = readFileSync(
      resolve(process.cwd(), "src/lib/slack/handlers/actions.ts"),
      "utf8"
    );
    const slackSync = readFileSync(
      resolve(process.cwd(), "src/lib/slack/sync.ts"),
      "utf8"
    );

    expect(webRoute).toContain("await notifyTicketMutation({");
    expect(slackActions).toContain("await notifyTicketMutation({");
    expect(webRoute).not.toContain("sendTicketResolved");
    expect(slackActions).not.toContain("updateMasterMessage");
    expect(slackSync).toContain("mrkdwn: false");
  });
});
