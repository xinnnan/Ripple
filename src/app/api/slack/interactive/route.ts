import { NextRequest, NextResponse } from "next/server";
import { WebClient } from "@slack/web-api";
import { handleBlockAction, handleViewSubmission } from "@/lib/slack/handlers/actions";
import { verifySlackSignature } from "@/lib/slack/verify";

export async function POST(request: NextRequest) {
  try {
    // Slack signs the raw body. We must read it as text BEFORE parsing.
    const rawBody = await request.text();
    const sigCheck = verifySlackSignature(
      rawBody,
      request.headers.get("x-slack-signature"),
      request.headers.get("x-slack-request-timestamp"),
      process.env.SLACK_SIGNING_SECRET ?? null
    );
    if (!sigCheck.ok) {
      console.warn(`[slack/interactive] signature rejected: ${sigCheck.reason}`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Re-parse the (now verified) body
    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get("payload");
    if (!payloadStr) {
      return NextResponse.json({ error: "Missing payload" }, { status: 400 });
    }
    const payload = JSON.parse(payloadStr);

    const { type } = payload;
    const client = new WebClient(process.env.SLACK_BOT_TOKEN);

    switch (type) {
      case "block_actions": {
        await handleBlockAction(payload, client);
        return NextResponse.json({ ok: true });
      }

      case "view_submission": {
        // view_submission must return either an empty body OR a
        // response_action object. We delegate to the handler.
        const result = await handleViewSubmission(payload, client);
        if (result) {
          return NextResponse.json(result);
        }
        return new NextResponse(null, { status: 200 });
      }

      case "view_closed": {
        // User clicked Cancel on a modal — no-op for now.
        return new NextResponse(null, { status: 200 });
      }

      default:
        return NextResponse.json({ ok: true });
    }
  } catch (error) {
    console.error("Slack interactive error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
