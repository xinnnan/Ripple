import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InvalidSlackEventCommentReplayError } from "@/lib/tickets/mutations";
import { captureSlackThreadReply } from "./events";

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const CHANNEL_RECORD_ID = "22222222-2222-4222-8222-222222222222";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR_ID = "44444444-4444-4444-8444-444444444444";
const COMMENT_ID = "55555555-5555-4555-8555-555555555555";

function eventPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "event_callback",
    event_id: "Ev0123456789ABCDEF",
    event: {
      type: "message",
      channel: "C0123456789",
      user: "U0123456789",
      ts: "1720000001.000200",
      thread_ts: "1720000000.000100",
      text: "  Conveyor is moving again.  ",
      ...overrides,
    },
  };
}

function queryBuilder(result: { data: unknown[] | null; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (
    resolve: (value: { data: unknown[] | null; error: unknown }) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function dependencies(args?: {
  sites?: unknown[];
  channels?: unknown[];
  messages?: unknown[];
  users?: unknown[];
}) {
  const builders = {
    sites: queryBuilder({ data: args?.sites ?? [{ id: SITE_ID }], error: null }),
    slack_channels: queryBuilder({
      data: args?.channels ?? [{ id: CHANNEL_RECORD_ID, site_id: SITE_ID }],
      error: null,
    }),
    slack_messages: queryBuilder({
      data: args?.messages ?? [{ ticket_id: TICKET_ID }],
      error: null,
    }),
    users: queryBuilder({ data: args?.users ?? [{ id: ACTOR_ID }], error: null }),
  };
  const from = vi.fn((table: keyof typeof builders) => builders[table]);
  const recordComment = vi.fn().mockResolvedValue(COMMENT_ID);
  return {
    value: {
      supabase: { from } as unknown as SupabaseClient,
      recordComment,
    },
    from,
    recordComment,
    builders,
  };
}

describe("Slack ticket-thread event capture", () => {
  it.each([
    [{ type: "app_mention" }, "not_human_message"],
    [{ bot_id: "B0123456789" }, "not_human_message"],
    [{ subtype: "message_changed" }, "not_human_message"],
    [{ thread_ts: "1720000001.000200" }, "not_thread_reply"],
    [{ thread_ts: undefined }, "not_thread_reply"],
    [{ text: "   " }, "unsupported_content"],
  ])("ignores unsupported messages without database access", async (event, reason) => {
    const deps = dependencies();

    await expect(
      captureSlackThreadReply(eventPayload(event), deps.value)
    ).resolves.toEqual({ outcome: "ignored", reason });
    expect(deps.from).not.toHaveBeenCalled();
    expect(deps.recordComment).not.toHaveBeenCalled();
  });

  it("captures a human reply against the canonical site and master thread", async () => {
    const deps = dependencies();

    await expect(
      captureSlackThreadReply(eventPayload(), deps.value)
    ).resolves.toEqual({ outcome: "recorded", commentId: COMMENT_ID });

    expect(deps.from.mock.calls.map(([table]) => table)).toEqual([
      "sites",
      "slack_channels",
      "slack_messages",
      "users",
    ]);
    expect(deps.builders.slack_messages.select).toHaveBeenCalledWith(
      "ticket_id, ticket:tickets!inner(site_id)"
    );
    expect(deps.builders.slack_messages.eq).toHaveBeenCalledWith(
      "ticket.site_id",
      SITE_ID
    );
    expect(deps.recordComment).toHaveBeenCalledWith({
      supabase: deps.value.supabase,
      ticketId: TICKET_ID,
      actorId: ACTOR_ID,
      body: "Conveyor is moving again.",
      idempotencyKey: "slack:message-event:Ev0123456789ABCDEF",
    });
  });

  it("accepts a human thread-broadcast subtype once", async () => {
    const deps = dependencies();

    await expect(
      captureSlackThreadReply(
        eventPayload({ subtype: "thread_broadcast" }),
        deps.value
      )
    ).resolves.toMatchObject({ outcome: "recorded" });
  });

  it.each([
    [{ sites: [] }, "unlinked_channel"],
    [{ channels: [] }, "unlinked_channel"],
    [{ messages: [] }, "unknown_thread"],
    [{ users: [] }, "unlinked_actor"],
  ])("ignores an unresolved boundary without writing", async (fixture, reason) => {
    const deps = dependencies(fixture);

    await expect(
      captureSlackThreadReply(eventPayload(), deps.value)
    ).resolves.toEqual({ outcome: "ignored", reason });
    expect(deps.recordComment).not.toHaveBeenCalled();
  });

  it("fails closed when a channel or identity mapping is ambiguous", async () => {
    const deps = dependencies({
      users: [{ id: ACTOR_ID }, { id: "66666666-6666-4666-8666-666666666666" }],
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      captureSlackThreadReply(eventPayload(), deps.value)
    ).rejects.toThrow("Slack event mapping is ambiguous");
    expect(deps.recordComment).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "[slack/events] actor mapping is ambiguous"
    );
    consoleError.mockRestore();
  });

  it("contains altered replay without creating a retry storm", async () => {
    const deps = dependencies();
    deps.recordComment.mockRejectedValue(
      new InvalidSlackEventCommentReplayError()
    );
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      captureSlackThreadReply(eventPayload(), deps.value)
    ).resolves.toEqual({ outcome: "ignored", reason: "replay_conflict" });
    expect(consoleWarn).toHaveBeenCalledWith(
      "[slack/events] altered event replay rejected"
    );
    consoleWarn.mockRestore();
  });
});
