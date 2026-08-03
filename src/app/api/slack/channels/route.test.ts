import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminMock, conversationsListMock, webClientMock } = vi.hoisted(
  () => ({
    requireAdminMock: vi.fn(),
    conversationsListMock: vi.fn(),
    webClientMock: vi.fn(function MockWebClient() {
      return { conversations: { list: conversationsListMock } };
    }),
  })
);

vi.mock("@/lib/supabase/auth-helpers", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("@slack/web-api", () => ({
  WebClient: webClientMock,
}));

import { GET } from "./route";

const originalToken = process.env.SLACK_BOT_TOKEN;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SLACK_BOT_TOKEN = "xoxb-real-token";
  requireAdminMock.mockResolvedValue({
    userId: "11111111-1111-4111-8111-111111111111",
    role: "admin",
  });
});

afterAll(() => {
  if (originalToken === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = originalToken;
});

describe("GET /api/slack/channels", () => {
  it("denies non-admin callers before Slack client construction", async () => {
    requireAdminMock.mockResolvedValueOnce({ error: "Forbidden", status: 403 });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(webClientMock).not.toHaveBeenCalled();
  });

  it("fails closed for absent or placeholder bot configuration", async () => {
    process.env.SLACK_BOT_TOKEN = "your-slack-bot-token";

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Slack integration is not configured",
    });
    expect(webClientMock).not.toHaveBeenCalled();
  });

  it("paginates, normalizes, deduplicates, sorts, and disables caching", async () => {
    conversationsListMock
      .mockResolvedValueOnce({
        channels: [
          { id: "C2", name: "zeta", is_private: undefined },
          { id: "C1", name: "alpha", is_private: true },
          { id: undefined, name: "ignored" },
        ],
        response_metadata: { next_cursor: " cursor-2 " },
      })
      .mockResolvedValueOnce({
        channels: [
          { id: "C2", name: "zeta", is_private: false },
          { id: "C3", name: "beta", is_private: false },
        ],
        response_metadata: { next_cursor: "" },
      });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      channels: [
        { id: "C1", name: "alpha", is_private: true },
        { id: "C3", name: "beta", is_private: false },
        { id: "C2", name: "zeta", is_private: false },
      ],
      truncated: false,
    });
    expect(conversationsListMock).toHaveBeenNthCalledWith(2, {
      types: "public_channel,private_channel",
      limit: 200,
      exclude_archived: true,
      cursor: "cursor-2",
    });
  });

  it("bounds pagination and reports a truncated channel list", async () => {
    conversationsListMock.mockResolvedValue({
      channels: [],
      response_metadata: { next_cursor: "more" },
    });

    const response = await GET();
    const body = await response.json();

    expect(conversationsListMock).toHaveBeenCalledTimes(10);
    expect(body.truncated).toBe(true);
  });

  it("contains Slack provider failures", async () => {
    conversationsListMock.mockRejectedValueOnce(
      Object.assign(new Error("provider request and token detail"), {
        code: "slack_webapi_platform_error",
      })
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: "Failed to fetch Slack channels" });
    expect(JSON.stringify(body)).not.toContain("provider");
    expect(consoleError).toHaveBeenCalledWith(
      "Error fetching Slack channels:",
      { code: "slack_webapi_platform_error" }
    );
    consoleError.mockRestore();
  });
});
