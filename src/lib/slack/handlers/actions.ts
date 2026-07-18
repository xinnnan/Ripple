import type { WebClient } from "@slack/web-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildResolveModal } from "../blocks/resolve-modal";
import { buildAskRippleAssistModal } from "../blocks/ai-modal";
import { createTicketCore, resolveSiteBySlackChannel } from "@/lib/tickets/create";
import { updateMasterMessage } from "../sync";
import type { Ticket } from "@/types/ticket";

interface ActionPayload {
  actions: { action_id: string; value?: string; selected_option?: { value: string } }[];
  user: { id: string; name: string };
  channel: { id: string; name: string };
  message?: { ts: string; thread_ts?: string };
  trigger_id: string;
  response_url: string;
}

export async function handleBlockAction(
  payload: ActionPayload,
  client: WebClient
) {
  if (!payload.actions || payload.actions.length === 0) return;

  const action = payload.actions[0];
  const ticketNo = action.value || "";
  const userId = payload.user.id;
  const channelId = payload.channel?.id;
  const messageTs = payload.message?.ts;

  const supabase = createAdminClient();

  // Find or create internal user from Slack user_id
  const { data: internalUser } = await supabase
    .from("users")
    .select("id")
    .eq("slack_user_id", userId)
    .single();

  switch (action.action_id) {
    case "assign_to_me": {
      if (!internalUser || !ticketNo) break;

      // Update ticket owner and status
      const { data: ticket } = await supabase
        .from("tickets")
        .update({
          owner_id: internalUser.id,
          status: "assigned",
        })
        .eq("ticket_no", ticketNo)
        .select(
          `*, customer:customers(name), site:sites(site_name, site_code), owner:users!tickets_owner_id_fkey(full_name)`
        )
        .single();

      if (ticket) {
        await updateMasterMessage(ticket as unknown as Ticket, {
          channelId,
          messageTs,
          client,
        });
      }
      break;
    }

    case "mark_in_progress": {
      if (!ticketNo) break;

      const { data: ticket } = await supabase
        .from("tickets")
        .update({ status: "in_progress" })
        .eq("ticket_no", ticketNo)
        .select(
          `*, customer:customers(name), site:sites(site_name, site_code), owner:users!tickets_owner_id_fkey(full_name)`
        )
        .single();

      if (ticket) {
        await updateMasterMessage(ticket as unknown as Ticket, {
          channelId,
          messageTs,
          client,
        });
      }
      break;
    }

    case "request_info": {
      if (!ticketNo) break;

      const { data: ticket } = await supabase
        .from("tickets")
        .update({ status: "waiting_customer" })
        .eq("ticket_no", ticketNo)
        .select(
          `*, customer:customers(name), site:sites(site_name, site_code), owner:users!tickets_owner_id_fkey(full_name)`
        )
        .single();

      if (ticket) {
        await updateMasterMessage(ticket as unknown as Ticket, {
          channelId,
          messageTs,
          client,
        });
      }
      break;
    }

    case "customer_update": {
      // Open a modal for the engineer to type a customer-visible update
      if (!ticketNo) break;
      try {
        await client.views.open({
          trigger_id: payload.trigger_id,
          view: {
            type: "modal",
            title: { type: "plain_text", text: `Update: ${ticketNo}` },
            submit: { type: "plain_text", text: "Post Update" },
            callback_id: "customer_update_submit",
            private_metadata: JSON.stringify({
              ticket_no: ticketNo,
              channel_id: channelId,
              message_ts: messageTs,
              user_id: internalUser?.id,
            }),
            blocks: [
              {
                type: "input",
                block_id: "update_text_block",
                element: {
                  type: "plain_text_input",
                  action_id: "update_text",
                  multiline: true,
                  placeholder: {
                    type: "plain_text",
                    text: "Type your customer-visible update...",
                  },
                },
                label: { type: "plain_text", text: "Customer Update" },
              },
            ],
          },
        });
      } catch (error) {
        console.error("Failed to open customer update modal:", error);
      }
      break;
    }

    case "resolve_ticket": {
      if (!ticketNo) break;
      try {
        const modal = buildResolveModal(ticketNo);
        await client.views.open({
          trigger_id: payload.trigger_id,
          view: {
            ...modal,
            callback_id: "resolve_form_submit",
            private_metadata: JSON.stringify({
              ticket_no: ticketNo,
              channel_id: channelId,
              message_ts: messageTs,
              user_id: internalUser?.id,
            }),
          },
        });
      } catch (error) {
        console.error("Failed to open resolve modal:", error);
      }
      break;
    }

    case "ask_ripple_assist": {
      if (!ticketNo) break;
      try {
        const modal = buildAskRippleAssistModal(ticketNo);
        await client.views.open({
          trigger_id: payload.trigger_id,
          view: modal,
        });
      } catch (error) {
        console.error("Failed to open AI modal:", error);
      }
      break;
    }

    default:
      console.log(`Unknown action: ${action.action_id}`);
  }
}

export async function handleViewSubmission(
  payload: { view: { callback_id: string; private_metadata: string; state: { values: Record<string, Record<string, { value?: string; selected_option?: { value: string }; type: string }>> } }; user: { id: string } },
  client: WebClient
) {
  const callbackId = payload.view.callback_id;
  const metadata = JSON.parse(payload.view.private_metadata || "{}");
  const state = payload.view.state.values;
  const supabase = createAdminClient();

  switch (callbackId) {
    case "ticket_form_submit": {
      // Extract form values
      const title = state.title_block?.title?.value || "";
      const requestType = state.request_type_block?.request_type?.selected_option?.value || "incident";
      const severity = state.severity_block?.severity?.selected_option?.value || "P3";
      const impact = state.impact_block?.impact?.selected_option?.value || "no_impact";
      const description = state.description_block?.description?.value || "";
      const assetId = state.asset_block?.asset_id?.value || "";
      const area = state.area_block?.area?.value || "";

      // Get or create user
      const { data: internalUser } = await supabase
        .from("users")
        .select("id")
        .eq("slack_user_id", payload.user.id)
        .single();

      // Determine site: prefer metadata from the modal's private_metadata
      // (set when the modal was opened in a known-bound channel), fall
      // back to looking up the channel → slack_channels → site mapping.
      let siteId = metadata.site_id;
      let customerId = metadata.customer_id;

      if (!siteId && metadata.channel_id) {
        const site = await resolveSiteBySlackChannel(supabase, metadata.channel_id);
        if (site) {
          siteId = site.id;
          customerId = site.customer_id;
        }
      }

      if (!siteId || !customerId) {
        return {
          response_action: "errors",
          errors: {
            title_block:
              "Could not determine site for this channel. Ask an admin to map it in /admin/sites.",
          },
        };
      }

      try {
        await createTicketCore(
          {
            customer_id: customerId,
            site_id: siteId,
            source: "slack",
            title,
            description,
            request_type: requestType as
              | "incident"
              | "service_request"
              | "question"
              | "change_request"
              | "parts_rma"
              | "deployment_issue"
              | "training_documentation",
            severity: severity as "P1" | "P2" | "P3" | "P4",
            impact: (impact || null) as
              | "safety"
              | "production_stopped"
              | "production_slowed"
              | "single_asset"
              | "no_impact"
              | null,
            asset_id: assetId || null,
            area: area || null,
            created_by: internalUser?.id ?? null,
          },
          {
            slackChannelId: metadata.channel_id,
            slackClient: client,
          }
        );
      } catch (err) {
        console.error("[ticket_form_submit] createTicketCore failed:", err);
        return {
          response_action: "errors",
          errors: { title_block: "Failed to create ticket. Please try again." },
        };
      }

      // Return success - close modal
      return { response_action: "clear" };
    }

    case "resolve_form_submit": {
      const ticketNo = metadata.ticket_no;
      const customerSummary = state.customer_summary_block?.customer_summary?.value || "";
      const rootCause = state.root_cause_block?.root_cause?.selected_option?.value || "unknown";
      const followUp = state.follow_up_block?.follow_up?.selected_option?.value || "no";
      const internalNotes = state.internal_notes_block?.internal_notes?.value || "";

      // Update ticket. Match the PATCH /api/tickets/[id] route:
      // when status transitions to "resolved", set resolved_at so
      // the column is consistent regardless of which path the
      // resolve came from (web vs Slack modal).
      const { data: currentTicket } = await supabase
        .from("tickets")
        .select("status")
        .eq("ticket_no", ticketNo)
        .maybeSingle();

      const updateObj: Record<string, unknown> = {
        status: "resolved",
        customer_visible_summary: customerSummary,
        root_cause_category: rootCause,
        follow_up_needed: followUp === "yes",
        internal_summary: internalNotes || null,
      };
      if (currentTicket && currentTicket.status !== "resolved") {
        updateObj.resolved_at = new Date().toISOString();
      }

      const { data: ticket } = await supabase
        .from("tickets")
        .update(updateObj)
        .eq("ticket_no", ticketNo)
        .select(
          `*, customer:customers(name), site:sites(site_name, site_code), owner:users!tickets_owner_id_fkey(full_name)`
        )
        .single();

      if (ticket) {
        await updateMasterMessage(ticket as unknown as Ticket, {
          channelId: metadata.channel_id,
          messageTs: metadata.message_ts,
          client,
        });
      }

      // Post resolution note in thread. Best-effort: if the channel
      // is gone or the bot was uninstalled, the ticket is still
      // resolved in the DB — don't let a Slack API error 500 the
      // whole view_submission (which would leave the modal stuck
      // open for the user).
      if (metadata.channel_id && metadata.message_ts) {
        try {
          await client.chat.postMessage({
            channel: metadata.channel_id,
            thread_ts: metadata.message_ts,
            text: `✅ *Ticket Resolved*\n\n${customerSummary}`,
          });
        } catch (e) {
          console.warn(
            "[slack/handlers] resolve thread post failed (non-fatal):",
            e instanceof Error ? e.message : e
          );
        }
      }

      return { response_action: "clear" };
    }

    case "customer_update_submit": {
      const updateText = state.update_text_block?.update_text?.value || "";
      const ticketNo = metadata.ticket_no;

      // Add comment
      const { data: ticket } = await supabase
        .from("tickets")
        .select("id")
        .eq("ticket_no", ticketNo)
        .single();

      if (ticket) {
        await supabase.from("ticket_comments").insert({
          ticket_id: ticket.id,
          author_id: metadata.user_id || null,
          body: updateText,
          visibility: "customer",
          source: "slack",
        });

        // Post in thread. Best-effort: a Slack API failure must
        // not lose the comment we just wrote to the DB.
        if (metadata.channel_id && metadata.message_ts) {
          try {
            await client.chat.postMessage({
              channel: metadata.channel_id,
              thread_ts: metadata.message_ts,
              text: `💬 *Customer Update:*\n${updateText}`,
            });
          } catch (e) {
            console.warn(
              "[slack/handlers] customer_update thread post failed (non-fatal):",
              e instanceof Error ? e.message : e
            );
          }
        }
      }

      return { response_action: "clear" };
    }

    case "ripple_assist_submit": {
      const taskType = state.task_type_block?.task_type?.selected_option?.value || "summary";
      const ticketNo = metadata.ticket_no;

      // Get ticket and user
      const { data: ticket } = await supabase
        .from("tickets")
        .select("id")
        .eq("ticket_no", ticketNo)
        .single();

      const { data: internalUser } = await supabase
        .from("users")
        .select("id")
        .eq("slack_user_id", payload.user.id)
        .single();

      if (ticket && internalUser) {
        // Call AI suggestion API
        try {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
          const res = await fetch(`${baseUrl}/api/ai/suggest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticket_id: ticket.id,
              suggestion_type: taskType,
              user_id: internalUser.id,
            }),
          });

          const data = await res.json();

          // Send ephemeral message to engineer
          if (metadata.channel_id || payload.user.id) {
            await client.chat.postEphemeral({
              channel: metadata.channel_id || "",
              user: payload.user.id,
              text: `🤖 *Ripple Assist — ${taskType}*\n\n${data.output_text || "No suggestion generated."}\n\n_Confidence: ${data.confidence_level || "unknown"} | Model: ${data.model_name || "unknown"}_`,
            });
          }
        } catch (error) {
          console.error("AI suggestion failed:", error);
          await client.chat.postEphemeral({
            channel: metadata.channel_id || "",
            user: payload.user.id,
            text: "❌ Ripple Assist failed to generate a suggestion. Please try again.",
          });
        }
      }

      return { response_action: "clear" };
    }

    default:
      console.log(`Unknown view submission: ${callbackId}`);
      return { response_action: "clear" };
  }
}
