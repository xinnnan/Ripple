import { NextRequest, NextResponse } from "next/server";
import { WebClient } from "@slack/web-api";
import { buildTicketFormModal } from "@/lib/slack/blocks/ticket-form";

export async function POST(request: NextRequest) {
  try {
    // Parse Slack slash command payload (sent as form-encoded)
    const formData = await request.formData();
    const channel_id = formData.get("channel_id") as string;
    const channel_name = formData.get("channel_name") as string;
    const user_id = formData.get("user_id") as string;
    const trigger_id = formData.get("trigger_id") as string;
    const text = formData.get("text") as string;

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
      text: "📝 Ticket form opened. Fill in the details and click *Create Ticket* to submit, or *Cancel* to discard.",
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
