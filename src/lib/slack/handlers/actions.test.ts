import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebClient } from "@slack/web-api";

const {
  createAdminClientMock,
  applyPatchMock,
  recordCommentMock,
  dispatchOutboxMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  applyPatchMock: vi.fn(),
  recordCommentMock: vi.fn(),
  dispatchOutboxMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/tickets/create", () => ({
  createTicketCore: vi.fn(),
  resolveSiteBySlackChannel: vi.fn(),
}));
vi.mock("@/lib/tickets/mutations", () => ({
  applyTicketPatchWithSla: applyPatchMock,
  recordTicketCommentWithSla: recordCommentMock,
  InvalidTicketTransitionError: class InvalidTicketTransitionError extends Error {},
}));
vi.mock("@/lib/tickets/outbox", () => ({
  dispatchTicketOutboxBestEffort: dispatchOutboxMock,
}));
vi.mock("@/lib/ai/service", () => ({ requestAiSuggestion: vi.fn() }));

import { handleBlockAction, handleViewSubmission } from "./actions";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";

function query(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.single = vi.fn().mockResolvedValue(result);
  return builder;
}

function supabase(args?: {
  ticket?: { id: string; status?: string };
}) {
  const userQuery = query({
    data: { id: USER_ID, role: "engineer" },
    error: null,
  });
  const ticketQuery = query({
    data: args?.ticket ?? { id: TICKET_ID, status: "new" },
    error: null,
  });
  const from = vi.fn((table: string) =>
    table === "users" ? userQuery : ticketQuery
  );
  return { client: { from }, from, userQuery, ticketQuery };
}

function slackClient() {
  return {
    chat: {
      postMessage: vi.fn(),
      postEphemeral: vi.fn(),
    },
    views: { open: vi.fn() },
  } as unknown as WebClient;
}

function customerUpdatePayload(update: string) {
  return {
    view: {
      id: "V0123456789ABCDEF",
      callback_id: "customer_update_submit",
      private_metadata: JSON.stringify({
        ticket_no: "RPL-000123",
        channel_id: "C123",
        message_ts: "123.456",
      }),
      state: {
        values: {
          update_text_block: {
            update_text: { type: "plain_text_input", value: update },
          },
        },
      },
    },
    user: { id: "U123" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  applyPatchMock.mockResolvedValue(TICKET_ID);
  recordCommentMock.mockResolvedValue(
    "33333333-3333-4333-8333-333333333333"
  );
  dispatchOutboxMock.mockResolvedValue({ claimed: 1, delivered: 1 });
});

describe("Slack mutation settlement", () => {
  it("records customer updates with a stable view key and durable delivery", async () => {
    const database = supabase();
    const client = slackClient();
    createAdminClientMock.mockReturnValue(database.client);

    await expect(
      handleViewSubmission(
        customerUpdatePayload("  Diagnostics are complete.  "),
        client
      )
    ).resolves.toEqual({ response_action: "clear" });

    expect(recordCommentMock).toHaveBeenCalledWith({
      supabase: database.client,
      ticketId: TICKET_ID,
      actorId: USER_ID,
      body: "Diagnostics are complete.",
      visibility: "customer",
      source: "slack",
      isAutomated: false,
      idempotencyKey: "slack:comment-view:V0123456789ABCDEF",
    });
    expect(dispatchOutboxMock).toHaveBeenCalledWith({
      aggregateId: TICKET_ID,
      slackOptions: {
        channelId: "C123",
        messageTs: "123.456",
        client,
      },
    });
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("returns a field error for blank updates before comment mutation", async () => {
    const database = supabase();
    createAdminClientMock.mockReturnValue(database.client);

    await expect(
      handleViewSubmission(customerUpdatePayload("   "), slackClient())
    ).resolves.toMatchObject({
      response_action: "errors",
      errors: { update_text_block: expect.any(String) },
    });
    expect(recordCommentMock).not.toHaveBeenCalled();
    expect(dispatchOutboxMock).not.toHaveBeenCalled();
  });

  it("does not hydrate after a committed Slack ticket patch", async () => {
    const database = supabase();
    const client = slackClient();
    createAdminClientMock.mockReturnValue(database.client);

    await handleBlockAction(
      {
        actions: [{ action_id: "assign_to_me", value: "RPL-000123" }],
        user: { id: "U123", name: "Engineer" },
        channel: { id: "C123", name: "site-support" },
        message: { ts: "123.456" },
        trigger_id: "trigger-1",
        response_url: "https://hooks.slack.test/response",
      },
      client
    );

    expect(applyPatchMock).toHaveBeenCalledWith({
      supabase: database.client,
      ticketId: TICKET_ID,
      actorId: USER_ID,
      patch: { owner_id: USER_ID, status: "assigned" },
      source: "slack",
    });
    expect(database.from).toHaveBeenCalledTimes(2);
    expect(dispatchOutboxMock).toHaveBeenCalledWith({
      aggregateId: TICKET_ID,
      slackOptions: { channelId: "C123", messageTs: "123.456", client },
    });
  });
});
