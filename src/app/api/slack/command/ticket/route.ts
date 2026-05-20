import { NextRequest, NextResponse } from "next/server";
import { buildTicketFormModal } from "@/lib/slack/blocks/ticket-form";

export async function POST(request: NextRequest) {
  try {
    // Parse Slack slash command payload
    const formData = await request.formData();
    const channel_id = formData.get("channel_id") as string;
    const channel_name = formData.get("channel_name") as string;
    const user_id = formData.get("user_id") as string;
    const trigger_id = formData.get("trigger_id") as string;
    const text = formData.get("text") as string;

    console.log(`/ticket command from user ${user_id} in channel ${channel_name} (${channel_id})`);

    // Open the ticket creation modal
    // For now, return the modal view definition
    // In production, this would call Slack's views.open API
    const modal = buildTicketFormModal();

    // Return modal to open via response_url or trigger_id
    // Slack expects a 200 response within 3 seconds
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Opening ticket creation form...",
    });
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
