import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebClient } from "@slack/web-api";
import type { Ticket } from "@/types/ticket";

const mocks = vi.hoisted(() => ({
  admin: { from: vi.fn() },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mocks.admin,
}));

import { postMasterMessage, postMasterThreadReply } from "./sync";

function selection(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function ticket(): Ticket {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    ticket_no: "RPL-000123",
    customer_id: "22222222-2222-4222-8222-222222222222",
    site_id: "33333333-3333-4333-8333-333333333333",
    source: "web",
    title: "Conveyor stopped",
    description: "The conveyor stopped.",
    request_type: "incident",
    severity: "P2",
    status: "new",
    asset_id: null,
    area: null,
    impact: null,
    owner_id: null,
    created_by: null,
    customer_visible_summary: null,
    internal_summary: null,
    secure_token: "secure-token",
    created_at: "2026-08-10T15:00:00.000Z",
    updated_at: "2026-08-10T15:00:00.000Z",
    resolved_at: null,
    closed_at: null,
    sla_policy_id: null,
    first_response_due_at: null,
    resolve_due_at: null,
    first_response_at: null,
    first_response_breached_at: null,
    resolution_breached_at: null,
    sla_breached: false,
    site: { slack_channel_id: "C123" },
  };
}

function slackClient(args: {
  postMessage?: ReturnType<typeof vi.fn>;
  history?: ReturnType<typeof vi.fn>;
  replies?: ReturnType<typeof vi.fn>;
} = {}): WebClient {
  return {
    token: "xoxb-test-token",
    slackApiUrl: "https://slack.com/api/",
    chat: {
      postMessage: args.postMessage ?? vi.fn(),
    },
    conversations: {
      history: args.history ?? vi.fn(),
      replies: args.replies ?? vi.fn(),
    },
  } as unknown as WebClient;
}

describe("Slack delivery settlement", () => {
  beforeEach(() => {
    mocks.admin.from.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              "x-oauth-scopes":
                "chat:write,channels:history,metadata.message:read",
            },
          })
        )
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails closed before provider I/O when the master receipt lookup fails", async () => {
    mocks.admin.from.mockReturnValue(
      selection({ data: null, error: { code: "XX000" } })
    );
    const postMessage = vi.fn();

    await expect(
      postMasterMessage(ticket(), { client: slackClient({ postMessage }) })
    ).resolves.toMatchObject({ ok: false, reason: "database_error" });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("recovers an ambiguous master post from Slack metadata without reposting", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.admin.from
      .mockReturnValueOnce(selection({ data: null, error: null }))
      .mockReturnValueOnce(
        selection({ data: { id: "channel-record-1" }, error: null })
      )
      .mockReturnValueOnce({ insert });
    const postMessage = vi.fn();
    const history = vi.fn().mockResolvedValue({
      messages: [
        {
          ts: "1786374000.000100",
          metadata: {
            event_type: "ripple_ticket_delivery",
            event_payload: { outbox_event_id: "delivery-1" },
          },
        },
      ],
    });

    await expect(
      postMasterMessage(ticket(), {
        client: slackClient({ postMessage, history }),
        deliveryKey: "delivery-1",
        reconcileDelivery: true,
        reconcileFrom: "2026-08-10T15:00:00.000Z",
      })
    ).resolves.toEqual({ ok: true, deduplicated: true });
    expect(postMessage).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith({
      ticket_id: "11111111-1111-4111-8111-111111111111",
      slack_channel_id: "channel-record-1",
      message_ts: "1786374000.000100",
      message_type: "master",
      outbox_event_id: "delivery-1",
    });
  });

  it("does not post a thread reply when its local receipt check is unavailable", async () => {
    mocks.admin.from
      .mockReturnValueOnce(
        selection({ data: { id: "channel-record-1" }, error: null })
      )
      .mockReturnValueOnce(
        selection({ data: null, error: { code: "XX000" } })
      );
    const postMessage = vi.fn();

    await expect(
      postMasterThreadReply(ticket(), "Update", {
        client: slackClient({ postMessage }),
        channelId: "C123",
        messageTs: "1786373900.000001",
        deliveryKey: "delivery-2",
      })
    ).resolves.toMatchObject({ ok: false, reason: "database_error" });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("records the durable attempt checkpoint before posting to Slack", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.admin.from
      .mockReturnValueOnce(selection({ data: null, error: null }))
      .mockReturnValueOnce(
        selection({ data: { id: "channel-record-1" }, error: null })
      )
      .mockReturnValueOnce({ insert });
    const postMessage = vi
      .fn()
      .mockResolvedValue({ ts: "1786374000.000200" });
    const beforeProviderAttempt = vi
      .fn()
      .mockResolvedValue("2026-08-10T15:00:01.000Z");

    await expect(
      postMasterMessage(ticket(), {
        client: slackClient({ postMessage }),
        deliveryKey: "delivery-8",
        beforeProviderAttempt,
      })
    ).resolves.toEqual({ ok: true });

    expect(beforeProviderAttempt).toHaveBeenCalledOnce();
    expect(beforeProviderAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      postMessage.mock.invocationCallOrder[0]
    );
  });

  it("fails closed when the attempt checkpoint cannot be committed", async () => {
    mocks.admin.from
      .mockReturnValueOnce(selection({ data: null, error: null }))
      .mockReturnValueOnce(
        selection({ data: { id: "channel-record-1" }, error: null })
      );
    const postMessage = vi.fn();

    await expect(
      postMasterMessage(ticket(), {
        client: slackClient({ postMessage }),
        deliveryKey: "delivery-9",
        beforeProviderAttempt: vi.fn().mockRejectedValue(new Error("db")),
      })
    ).resolves.toEqual({
      ok: false,
      reason: "database_error",
      error: "Slack provider attempt could not be recorded",
    });
    expect(postMessage).not.toHaveBeenCalled();
  });
});
