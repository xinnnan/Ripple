import type { WebClient } from "@slack/web-api";
import { buildTicketFormModal } from "../blocks/ticket-form";
import { createAdminClient } from "@/lib/supabase/admin";

interface CommandPayload {
  channel_id: string;
  channel_name: string;
  user_id: string;
  trigger_id: string;
  text: string;
  team_id: string;
}

export async function handleTicketCommand(
  payload: CommandPayload,
  client: WebClient
) {
  const { channel_id, channel_name, user_id, trigger_id } = payload;

  // Try to find the site associated with this channel
  const supabase = createAdminClient();
  const { data: slackChannel } = await supabase
    .from("slack_channels")
    .select("site_id, sites(id, customer_id, site_name, site_code)")
    .eq("channel_id", channel_id)
    .single();

  // Build the ticket form modal
  const modal = buildTicketFormModal();

  // If we found the site, we could pre-fill customer/site info
  // For now, open the generic form
  try {
    await client.views.open({
      trigger_id: trigger_id,
      view: {
        ...modal,
        callback_id: "ticket_form_submit",
        private_metadata: JSON.stringify({
          channel_id,
          channel_name,
          user_id,
          site_id: slackChannel?.site_id || null,
          customer_id: (slackChannel?.sites as unknown as { customer_id: string } | null)?.customer_id || null,
        }),
      },
    });
  } catch (error) {
    console.error("Failed to open ticket modal:", error);
    // Fallback: send ephemeral message
    await client.chat.postEphemeral({
      channel: channel_id,
      user: user_id,
      text: "❌ Failed to open ticket form. Please try again or contact support.",
    });
  }
}
