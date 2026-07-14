import { NextRequest, NextResponse } from "next/server";
import { WebClient } from "@slack/web-api";
import { buildTicketFormModal } from "@/lib/slack/blocks/ticket-form";
import { verifySlackSignature } from "@/lib/slack/verify";

export async function POST(request: NextRequest) {
  try {
    // Slack signs the raw body. We must read it as text BEFORE parsing
    // the form data, because once we call request.formData() the body
    // is consumed. (The /events + /interactive routes hit this same
    // gotcha — see c5b4c1b for the fix there.)
    const rawBody = await request.text();
    const sigCheck = verifySlackSignature(
      rawBody,
      request.headers.get("x-slack-signature"),
      request.headers.get("x-slack-request-timestamp"),
      process.env.SLACK_SIGNING_SECRET ?? null
    );
    if (!sigCheck.ok) {
      console.warn(
        `[slack/command/ticket] signature rejected: ${sigCheck.reason}`
      );
      return NextResponse.json(
        {
          response_type: "ephemeral",
          text: "❌ Signature verification failed.",
        },
        { status: 401 }
      );
    }

    // Re-parse the (now verified) body as form data.
    const params = new URLSearchParams(rawBody);
    const channel_id = params.get("channel_id") || "";
    const channel_name = params.get("channel_name") || "";
    const user_id = params.get("user_id") || "";
    const trigger_id = params.get("trigger_id") || "";
    const text = params.get("text") || "";

    console.log(
      `/ticket command from user ${user_id} in channel ${channel_name} (${channel_id})`
    );

    if (!process.env.SLACK_BOT_TOKEN) {
      console.error("Missing SLACK_BOT_TOKEN");
      return NextResponse.json(
        {
          response_type: "ephemeral",
          text: "❌ Server configuration error. Please contact support.",
        },
        { status: 500 }
      );
    }

    // Build the ticket form modal
    const modal = buildTicketFormModal();

    // Use Slack Web API to open the modal
    const client = new WebClient(process.env.SLACK_BOT_TOKEN);

    await client.views.open({
      trigger_id: trigger_id,
      view: {
        type: modal.type,
        title: modal.title,
        submit: modal.submit,
        close: {
          type: "plain_text",
          text: "Cancel",
        },
        blocks: modal.blocks,
        callback_id: "ticket_form_submit",
        private_metadata: JSON.stringify({
          channel_id,
          channel_name,
          user_id,
        }),
      },
    });

    // Send an ephemeral hint to the user
    await client.chat.postEphemeral({
      channel: channel_id,
      user: user_id,
      text: "📝 Ticket form opened. Fill in the details and click *Create Ticket* to submit, or *Cancel* to discard.\n\n💡 _Tip: After creating the ticket, you can attach photos, videos, or log files by posting them in this channel._",
    });

    // Return empty 200 with no body — Slack won't show any message
    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("Slack /ticket command error:", error);
    return NextResponse.json(
      {
        response_type: "ephemeral",
        text: "❌ Failed to open ticket form. Please try again.",
      },
      { status: 500 }
    );
  }
}
