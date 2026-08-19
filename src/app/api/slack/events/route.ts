import { NextRequest, NextResponse } from "next/server";
import {
  getSlackSignatureFailureHttpStatus,
  verifySlackSignature,
} from "@/lib/slack/verify";
import { isSlackBotTokenConfigured } from "@/lib/slack/config";
import { captureSlackThreadReply } from "@/lib/slack/handlers/events";

export async function POST(request: NextRequest) {
  try {
    // Read raw body for signature verification (must be before JSON.parse).
    const rawBody = await request.text();
    const sigCheck = verifySlackSignature(
      rawBody,
      request.headers.get("x-slack-signature"),
      request.headers.get("x-slack-request-timestamp"),
      process.env.SLACK_SIGNING_SECRET ?? null
    );
    if (!sigCheck.ok) {
      const status = getSlackSignatureFailureHttpStatus(sigCheck) ?? 401;
      console.warn(`[slack/events] signature rejected: ${sigCheck.reason}`);
      return NextResponse.json(
        {
          error:
            status === 503
              ? "Slack integration unavailable"
              : "Invalid signature",
          code:
            status === 503
              ? "SLACK_CONFIGURATION_ERROR"
              : "SLACK_SIGNATURE_INVALID",
        },
        { status }
      );
    }
    if (!isSlackBotTokenConfigured(process.env.SLACK_BOT_TOKEN)) {
      console.error("Slack bot token is missing or invalid");
      return NextResponse.json(
        {
          error: "Slack integration unavailable",
          code: "SLACK_CONFIGURATION_ERROR",
        },
        { status: 503 }
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Handle Slack URL verification challenge
    if (
      typeof body === "object" &&
      body !== null &&
      "type" in body &&
      body.type === "url_verification" &&
      "challenge" in body &&
      typeof body.challenge === "string"
    ) {
      return NextResponse.json({ challenge: body.challenge });
    }

    // Signed human replies to a known master-card thread are captured through
    // migration 053's replay-safe command. Bot messages, root messages,
    // unlinked users/channels, and unrelated events remain intentional no-ops.
    await captureSlackThreadReply(body);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Slack events error:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
