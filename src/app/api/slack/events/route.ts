import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/verify";

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
      console.warn(`[slack/events] signature rejected: ${sigCheck.reason}`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const body = JSON.parse(rawBody);

    // Handle Slack URL verification challenge
    if (body.type === "url_verification" && body.challenge) {
      return NextResponse.json({ challenge: body.challenge });
    }

    // Real event handling: message / reaction_added / app_mention / etc.
    // For now we just acknowledge. Future Sprint 3 can wire this up.
    if (body.type === "event_callback" && body.event) {
      const event = body.event;
      // Minimal handling: ignore bot messages, ignore message edits, etc.
      if (event.type === "message" && !event.subtype && !event.bot_id) {
        // TODO Sprint 3: route customer messages posted in a site
        // channel to a comment on the linked ticket.
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Slack events error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
