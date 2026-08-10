import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebClient } from "@slack/web-api";
import { findSlackDeliveryByMetadata } from "./delivery-reconciliation";

const attemptedAt = "2026-08-10T15:00:00.000Z";

function client(args: {
  history?: ReturnType<typeof vi.fn>;
  replies?: ReturnType<typeof vi.fn>;
}): WebClient {
  return {
    token: "xoxb-test-token",
    slackApiUrl: "https://slack.com/api/",
    conversations: {
      history: args.history ?? vi.fn(),
      replies: args.replies ?? vi.fn(),
    },
  } as unknown as WebClient;
}

function grantScopes(...scopes: string[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          ...(scopes.length > 0
            ? { headers: { "x-oauth-scopes": scopes.join(",") } }
            : {}),
        })
      )
    )
  );
}

describe("Slack delivery reconciliation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("finds a master message by its outbox metadata in a bounded window", async () => {
    grantScopes("chat:write", "metadata.message:read", "channels:history");
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
      findSlackDeliveryByMetadata({
        client: client({ history }),
        channelId: "C123",
        deliveryKey: "delivery-1",
        attemptedAt,
      })
    ).resolves.toEqual({ ok: true, messageTs: "1786374000.000100" });
    expect(history).toHaveBeenCalledWith({
      channel: "C123",
      include_all_metadata: true,
      inclusive: true,
      limit: 15,
      oldest: "1786373400.000000",
      latest: "1786374600.000000",
    });
  });

  it("uses thread replies and ignores unrelated metadata", async () => {
    grantScopes("metadata.message:read", "groups:history");
    const replies = vi.fn().mockResolvedValue({
      messages: [
        {
          ts: "1786374000.000101",
          metadata: {
            event_type: "another_event",
            event_payload: { outbox_event_id: "delivery-2" },
          },
        },
        {
          ts: "1786374000.000102",
          metadata: {
            event_type: "ripple_ticket_delivery",
            event_payload: { outbox_event_id: "delivery-2" },
          },
        },
      ],
    });

    const result = await findSlackDeliveryByMetadata({
      client: client({ replies }),
      channelId: "C123",
      deliveryKey: "delivery-2",
      attemptedAt,
      threadTs: "1786373900.000001",
    });

    expect(result).toEqual({ ok: true, messageTs: "1786374000.000102" });
    expect(replies).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        ts: "1786373900.000001",
        include_all_metadata: true,
      })
    );
  });

  it("distinguishes a proven absence from a failed provider lookup", async () => {
    grantScopes("metadata.message:read", "channels:history");
    const history = vi
      .fn()
      .mockResolvedValueOnce({ messages: [] })
      .mockRejectedValueOnce({ data: { error: "missing_scope" } });
    const slack = client({ history });

    await expect(
      findSlackDeliveryByMetadata({
        client: slack,
        channelId: "C123",
        deliveryKey: "delivery-3",
        attemptedAt,
      })
    ).resolves.toEqual({ ok: true, messageTs: null });
    await expect(
      findSlackDeliveryByMetadata({
        client: slack,
        channelId: "C123",
        deliveryKey: "delivery-3",
        attemptedAt,
      })
    ).resolves.toEqual({ ok: false, errorCode: "missing_scope" });
  });

  it("rejects an invalid attempt timestamp without provider I/O", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const history = vi.fn();
    const result = await findSlackDeliveryByMetadata({
      client: client({ history }),
      channelId: "C123",
      deliveryKey: "delivery-4",
      attemptedAt: "not-a-date",
    });

    expect(result).toEqual({
      ok: false,
      errorCode: "invalid_reconciliation_window",
    });
    expect(history).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed before history lookup when metadata visibility is not granted", async () => {
    grantScopes("chat:write", "channels:history");
    const history = vi.fn();

    const result = await findSlackDeliveryByMetadata({
      client: client({ history }),
      channelId: "C123",
      deliveryKey: "delivery-5",
      attemptedAt,
    });

    expect(result).toEqual({
      ok: false,
      errorCode: "missing_metadata_read_scope",
    });
    expect(history).not.toHaveBeenCalled();
  });

  it("fails closed when Slack does not return verifiable scope evidence", async () => {
    grantScopes();
    const history = vi.fn();

    const result = await findSlackDeliveryByMetadata({
      client: client({ history }),
      channelId: "C123",
      deliveryKey: "delivery-6",
      attemptedAt,
    });

    expect(result).toEqual({
      ok: false,
      errorCode: "reconciliation_scopes_unverified",
    });
    expect(history).not.toHaveBeenCalled();
  });

  it("bounds Slack authentication failures without exposing provider text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), {
          status: 200,
        })
      )
    );
    const history = vi.fn();

    const result = await findSlackDeliveryByMetadata({
      client: client({ history }),
      channelId: "C123",
      deliveryKey: "delivery-7",
      attemptedAt,
    });

    expect(result).toEqual({ ok: false, errorCode: "invalid_auth" });
    expect(history).not.toHaveBeenCalled();
  });

  it("does not claim absence when Slack truncated the bounded window", async () => {
    grantScopes("metadata.message:read", "channels:history");
    const history = vi.fn().mockResolvedValue({
      messages: [],
      has_more: true,
      response_metadata: { next_cursor: "next-page" },
    });

    const result = await findSlackDeliveryByMetadata({
      client: client({ history }),
      channelId: "C123",
      deliveryKey: "delivery-8",
      attemptedAt,
    });

    expect(result).toEqual({
      ok: false,
      errorCode: "reconciliation_window_truncated",
    });
  });
});
