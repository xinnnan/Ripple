import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { captureSlackThreadReply, verifySlackSignature, signatureStatus } =
  vi.hoisted(() => ({
    captureSlackThreadReply: vi.fn(),
    verifySlackSignature: vi.fn(),
    signatureStatus: vi.fn(),
  }));

vi.mock("@/lib/slack/handlers/events", () => ({ captureSlackThreadReply }));
vi.mock("@/lib/slack/verify", () => ({
  verifySlackSignature,
  getSlackSignatureFailureHttpStatus: signatureStatus,
}));

import { POST } from "./route";

const originalBotToken = process.env.SLACK_BOT_TOKEN;
const originalSigningSecret = process.env.SLACK_SIGNING_SECRET;

function request(body: string) {
  return new NextRequest("http://localhost/api/slack/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-signature": "v0=signed",
      "x-slack-request-timestamp": "1720000000",
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SLACK_BOT_TOKEN = "xoxb-real-token";
  process.env.SLACK_SIGNING_SECRET = "real-signing-secret";
  verifySlackSignature.mockReturnValue({ ok: true });
  signatureStatus.mockReturnValue(401);
  captureSlackThreadReply.mockResolvedValue({ outcome: "ignored" });
});

afterAll(() => {
  if (originalBotToken === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = originalBotToken;
  if (originalSigningSecret === undefined) delete process.env.SLACK_SIGNING_SECRET;
  else process.env.SLACK_SIGNING_SECRET = originalSigningSecret;
});

describe("POST /api/slack/events", () => {
  it("rejects an invalid signature before parsing or capture", async () => {
    verifySlackSignature.mockReturnValue({ ok: false, reason: "mismatch" });
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await POST(request("{"));

    expect(response.status).toBe(401);
    expect(captureSlackThreadReply).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "SLACK_SIGNATURE_INVALID",
    });
    consoleWarn.mockRestore();
  });

  it("fails closed when the bot configuration is absent", async () => {
    process.env.SLACK_BOT_TOKEN = "your-slack-bot-token";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request(JSON.stringify({ type: "event_callback" })));

    expect(response.status).toBe(503);
    expect(captureSlackThreadReply).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "SLACK_CONFIGURATION_ERROR",
    });
    consoleError.mockRestore();
  });

  it("returns a stable 400 for malformed signed JSON", async () => {
    const response = await POST(request("{"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON body" });
    expect(captureSlackThreadReply).not.toHaveBeenCalled();
  });

  it("answers URL verification without invoking event capture", async () => {
    const response = await POST(
      request(JSON.stringify({ type: "url_verification", challenge: "challenge-1" }))
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ challenge: "challenge-1" });
    expect(captureSlackThreadReply).not.toHaveBeenCalled();
  });

  it("passes a verified event envelope to the replay-safe handler", async () => {
    const payload = {
      type: "event_callback",
      event_id: "Ev0123456789ABCDEF",
      event: { type: "message" },
    };

    const response = await POST(request(JSON.stringify(payload)));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(captureSlackThreadReply).toHaveBeenCalledWith(payload);
  });

  it("contains database failures without exposing detail", async () => {
    captureSlackThreadReply.mockRejectedValue(
      new Error("private database and tenant detail")
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      request(JSON.stringify({ type: "event_callback", event: {} }))
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(body)).not.toContain("private");
    expect(consoleError).toHaveBeenCalledWith("Slack events error:", {
      name: "Error",
    });
    consoleError.mockRestore();
  });
});
