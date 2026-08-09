import type { WebClient } from "@slack/web-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildResolveModal } from "../blocks/resolve-modal";
import { buildAskRippleAssistModal } from "../blocks/ai-modal";
import { createTicketCore, resolveSiteBySlackChannel } from "@/lib/tickets/create";
import { INTERNAL_ROLES } from "@/lib/roles";
import {
  IMPACT_LABELS,
  REQUEST_TYPE_LABELS,
  SEVERITY_LABELS,
  type Ticket,
} from "@/types/ticket";
import {
  applyTicketPatchWithSla,
  InvalidTicketTransitionError,
  recordTicketCommentWithSla,
  type TicketPatch,
} from "@/lib/tickets/mutations";
import { dispatchTicketOutboxBestEffort } from "@/lib/tickets/outbox";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requestAiSuggestion } from "@/lib/ai/service";
import {
  AiSuggestionRateLimitError,
  AiSuggestionTicketNotFoundError,
  AiSuggestionUnavailableError,
} from "@/lib/ai/errors";
import { isSuggestionType } from "@/lib/ai/suggest";
import {
  buildSlackTicketCommentIdempotencyKey,
  buildSlackTicketIdempotencyKey,
} from "@/lib/tickets/idempotency";
import {
  TICKET_COMMENT_MAX_LENGTH,
  TICKET_CONTEXT_MAX_LENGTH,
  TICKET_DESCRIPTION_MAX_LENGTH,
  TICKET_SUMMARY_MAX_LENGTH,
  TICKET_TITLE_MAX_LENGTH,
} from "@/lib/tickets/input-contract";

interface ActionPayload {
  actions: { action_id: string; value?: string; selected_option?: { value: string } }[];
  user: { id: string; name: string };
  channel: { id: string; name: string };
  message?: { ts: string; thread_ts?: string };
  trigger_id: string;
  response_url: string;
}

async function applySlackTicketPatch(args: {
  supabase: SupabaseClient;
  ticketNo: string;
  actorId: string;
  patch:
    | TicketPatch
    | ((currentStatus: Ticket["status"]) => TicketPatch);
  slackOptions?: {
    channelId?: string | null;
    messageTs?: string | null;
    client?: WebClient;
  };
}) {
  const { data: currentTicket, error: lookupError } = await args.supabase
    .from("tickets")
    .select("id, status")
    .eq("ticket_no", args.ticketNo)
    .maybeSingle();

  if (lookupError || !currentTicket) {
    throw new Error("Slack ticket lookup failed");
  }

  const patch =
    typeof args.patch === "function"
      ? args.patch(currentTicket.status as Ticket["status"])
      : args.patch;

  await applyTicketPatchWithSla({
    supabase: args.supabase,
    ticketId: currentTicket.id,
    actorId: args.actorId,
    patch,
    source: "slack",
  });

  // The database command has committed at this point. Do not turn a later
  // presentation hydration read into a false Slack failure/retry. The outbox
  // worker loads the authoritative ticket projection for delivery.
  await dispatchTicketOutboxBestEffort({
    aggregateId: currentTicket.id,
    slackOptions: args.slackOptions,
  });
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

  // Find the internal user from the Slack user_id. Slack signs the
  // request, so the payload is authentic — but that only proves the
  // request came from Slack, not that the user is one of our
  // engineers. We must gate by DB membership: only users who have
  // been provisioned in public.users with a matching slack_user_id
  // can mutate tickets. Without this gate, any Slack member of the
  // channel could fire a block_action and the audit log would write
  // a row with actor_id=NULL and actor_role='engineer' (a lie).
  const { data: internalUser } = await supabase
    .from("users")
    .select("id, role")
    .eq("slack_user_id", userId)
    .in("role", INTERNAL_ROLES)
    .eq("status", "active")
    .maybeSingle();

  if (!internalUser) {
    // Not an internal user. Reply ephemerally and skip the action.
    if (channelId) {
      try {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: "❌ Your Slack account isn't linked to an active internal Ripple user. Ask an admin to verify the Slack mapping, role, and account status.",
        });
      } catch (e) {
        console.warn("[slack/handlers] ephemeral reply failed (non-fatal):", e instanceof Error ? e.message : e);
      }
    }
    return;
  }

  try {
    switch (action.action_id) {
    case "assign_to_me": {
      if (!ticketNo) break;

      await applySlackTicketPatch({
        supabase,
        ticketNo,
        actorId: internalUser.id,
        patch: (currentStatus) => ({
          owner_id: internalUser.id,
          ...(currentStatus === "new" || currentStatus === "reopened"
            ? { status: "assigned" as const }
            : {}),
        }),
        slackOptions: { channelId, messageTs, client },
      });
      break;
    }

    case "mark_in_progress": {
      if (!ticketNo) break;

      await applySlackTicketPatch({
        supabase,
        ticketNo,
        actorId: internalUser.id,
        patch: { status: "in_progress" },
        slackOptions: { channelId, messageTs, client },
      });
      break;
    }

    case "request_info": {
      if (!ticketNo) break;

      await applySlackTicketPatch({
        supabase,
        ticketNo,
        actorId: internalUser.id,
        patch: { status: "waiting_customer" },
        slackOptions: { channelId, messageTs, client },
      });
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
            }),
            blocks: [
              {
                type: "input",
                block_id: "update_text_block",
                element: {
                  type: "plain_text_input",
                  action_id: "update_text",
                  multiline: true,
                  max_length: Math.min(TICKET_COMMENT_MAX_LENGTH, 3_000),
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
        const modal = buildAskRippleAssistModal(ticketNo, {
          channelId,
          messageTs,
        });
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
  } catch (error) {
    if (error instanceof InvalidTicketTransitionError && channelId) {
      try {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: `❌ ${error.message}`,
        });
      } catch (postError) {
        console.warn(
          "[slack/handlers] transition error reply failed (non-fatal):",
          postError instanceof Error ? postError.message : postError
        );
      }
      return;
    }
    throw error;
  }
}

export async function handleViewSubmission(
  payload: { view: { id: string; callback_id: string; private_metadata: string; state: { values: Record<string, Record<string, { value?: string; selected_option?: { value: string }; type: string }>> } }; user: { id: string } },
  client: WebClient
) {
  const callbackId = payload.view.callback_id;
  const metadata = JSON.parse(payload.view.private_metadata || "{}");
  const state = payload.view.state.values;
  const supabase = createAdminClient();

  // Find the internal user from Slack user_id. See the same gate
  // in handleBlockAction for the rationale: only internal users
  // (admin / engineer) can mutate tickets or post engineer-attributed
  // comments. The /ticket modal path is the exception (anyone in a
  // channel can file a ticket for that site), but the ticket is
  // created with created_by=null and the source is 'slack' so the
  // audit log + UI make it clear it came from a customer.
  //
  // For non-ticket_form_submit callbacks, missing internalUser is
  // a hard reject — they all post engineer-attributed content.
  const { data: internalUser } = await supabase
    .from("users")
    .select("id, role")
    .eq("slack_user_id", payload.user.id)
    .in("role", INTERNAL_ROLES)
    .eq("status", "active")
    .maybeSingle();

  if (callbackId !== "ticket_form_submit" && !internalUser) {
    return {
      response_action: "errors",
      errors: {
        // Slack renders this against the first block of the modal.
        title_block:
          "Your Slack account isn't linked to an active internal Ripple user. Ask an admin to verify the mapping, role, and status.",
      },
    };
  }

  switch (callbackId) {
    case "ticket_form_submit": {
      // Extract form values
      const title = (state.title_block?.title?.value || "").trim();
      const requestType =
        state.request_type_block?.request_type?.selected_option?.value || "";
      const severity =
        state.severity_block?.severity?.selected_option?.value || "";
      const impact =
        state.impact_block?.impact?.selected_option?.value || "";
      const description = (
        state.description_block?.description?.value || ""
      ).trim();
      const assetId = (state.asset_block?.asset_id?.value || "").trim();
      const area = (state.area_block?.area?.value || "").trim();
      const errors: Record<string, string> = {};

      if (!title || title.length > TICKET_TITLE_MAX_LENGTH) {
        errors.title_block = `Enter a title between 1 and ${TICKET_TITLE_MAX_LENGTH} characters.`;
      }
      if (!(requestType in REQUEST_TYPE_LABELS)) {
        errors.request_type_block = "Select a supported request type.";
      }
      if (!(severity in SEVERITY_LABELS)) {
        errors.severity_block = "Select a supported severity.";
      }
      if (!(impact in IMPACT_LABELS)) {
        errors.impact_block = "Select a supported production impact.";
      }
      if (
        !description ||
        description.length > TICKET_DESCRIPTION_MAX_LENGTH
      ) {
        errors.description_block = `Enter a description between 1 and ${TICKET_DESCRIPTION_MAX_LENGTH.toLocaleString()} characters.`;
      }
      if (assetId.length > TICKET_CONTEXT_MAX_LENGTH) {
        errors.asset_block = `Asset context cannot exceed ${TICKET_CONTEXT_MAX_LENGTH} characters.`;
      }
      if (area.length > TICKET_CONTEXT_MAX_LENGTH) {
        errors.area_block = `Area context cannot exceed ${TICKET_CONTEXT_MAX_LENGTH} characters.`;
      }
      if (Object.keys(errors).length > 0) {
        return { response_action: "errors", errors };
      }

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
            idempotency_key: buildSlackTicketIdempotencyKey(payload.view.id),
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
      } catch (error) {
        console.error("[ticket_form_submit] createTicketCore failed:", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
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

      if (
        !customerSummary.trim() ||
        customerSummary.length > TICKET_SUMMARY_MAX_LENGTH
      ) {
        return {
          response_action: "errors",
          errors: {
            customer_summary_block: `Enter a resolution summary between 1 and ${TICKET_SUMMARY_MAX_LENGTH.toLocaleString()} characters.`,
          },
        };
      }
      if (internalNotes.length > TICKET_SUMMARY_MAX_LENGTH) {
        return {
          response_action: "errors",
          errors: {
            internal_notes_block: `Internal notes cannot exceed ${TICKET_SUMMARY_MAX_LENGTH.toLocaleString()} characters.`,
          },
        };
      }

      // The same row-locked command used by the web PATCH path records the
      // actual resolution time, compares it to resolve_due_at, and commits
      // the ticket + milestone + timeline + audit rows together.
      try {
        await applySlackTicketPatch({
          supabase,
          ticketNo,
          actorId: internalUser!.id,
          patch: {
            status: "resolved",
            customer_visible_summary: customerSummary.trim(),
            root_cause_category: rootCause,
            follow_up_needed: followUp === "yes",
            internal_summary: internalNotes.trim() || null,
          },
          slackOptions: {
            channelId: metadata.channel_id,
            messageTs: metadata.message_ts,
            client,
          },
        });
      } catch (error) {
        if (error instanceof InvalidTicketTransitionError) {
          return {
            response_action: "errors",
            errors: { customer_summary_block: error.message },
          };
        }
        throw error;
      }

      return { response_action: "clear" };
    }

    case "customer_update_submit": {
      const updateText = (
        state.update_text_block?.update_text?.value || ""
      ).trim();
      const ticketNo = metadata.ticket_no;

      if (!updateText || updateText.length > TICKET_COMMENT_MAX_LENGTH) {
        return {
          response_action: "errors",
          errors: {
            update_text_block: `Enter a customer update between 1 and ${TICKET_COMMENT_MAX_LENGTH.toLocaleString()} characters.`,
          },
        };
      }

      const { data: ticket, error: lookupError } = await supabase
        .from("tickets")
        .select("id")
        .eq("ticket_no", ticketNo)
        .single();

      if (lookupError || !ticket) {
        throw new Error("Slack customer-update lookup failed");
      }

      if (ticket) {
        await recordTicketCommentWithSla({
          supabase,
          ticketId: ticket.id,
          actorId: internalUser!.id,
          body: updateText,
          visibility: "customer",
          source: "slack",
          isAutomated: false,
          idempotencyKey: buildSlackTicketCommentIdempotencyKey(
            payload.view.id
          ),
        });

        await dispatchTicketOutboxBestEffort({
          aggregateId: ticket.id,
          slackOptions: {
            channelId: metadata.channel_id,
            messageTs: metadata.message_ts,
            client,
          },
        });
      }

      return { response_action: "clear" };
    }

    case "ripple_assist_submit": {
      const taskType = state.task_type_block?.task_type?.selected_option?.value || "summary";
      const ticketNo = metadata.ticket_no;

      if (!isSuggestionType(taskType)) {
        return {
          response_action: "errors",
          errors: {
            task_type_block: "Select a supported Ripple Assist task.",
          },
        };
      }

      const { data: ticket, error: ticketError } = await supabase
        .from("tickets")
        .select("id")
        .eq("ticket_no", ticketNo)
        .maybeSingle();

      if (ticketError || !ticket) {
        return {
          response_action: "errors",
          errors: {
            task_type_block: "Ticket not found. Close the modal and try again.",
          },
        };
      }

      if (!metadata.channel_id) {
        return {
          response_action: "errors",
          errors: {
            task_type_block:
              "Slack channel context is missing. Close the modal and try again.",
          },
        };
      }

      try {
        const data = await requestAiSuggestion({
          ticketId: ticket.id,
          suggestionType: taskType,
          actorId: internalUser!.id,
        });

        await client.chat.postEphemeral({
          channel: metadata.channel_id,
          user: payload.user.id,
          text: `🤖 *Ripple Assist — ${taskType}*\n\n${data.output_text || "No suggestion generated."}\n\n_Confidence: ${data.confidence_level || "unknown"} | Model: ${data.model_name || "unknown"}_${data._persistence_warning ? "\n\n⚠️ This result could not be saved to ticket history. Copy it before closing Slack." : ""}`,
        });
      } catch (error) {
        console.error("AI suggestion failed:", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
        const text =
          error instanceof AiSuggestionRateLimitError
            ? `⏳ ${error.message}`
            : error instanceof AiSuggestionTicketNotFoundError ||
              error instanceof AiSuggestionUnavailableError
            ? `❌ ${error.message}`
            : "❌ Ripple Assist failed to generate a suggestion. Please try again.";
        try {
          await client.chat.postEphemeral({
            channel: metadata.channel_id,
            user: payload.user.id,
            text,
          });
        } catch (postError) {
          console.warn(
            "[slack/handlers] Ripple Assist error reply failed (non-fatal):",
            postError instanceof Error ? postError.message : postError
          );
        }
      }

      return { response_action: "clear" };
    }

    default:
      console.log(`Unknown view submission: ${callbackId}`);
      return { response_action: "clear" };
  }
}
