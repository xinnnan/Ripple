import type { KnownBlock, Block } from "@slack/web-api";

export function buildResolveModal(ticketNo: string): {
  type: "modal";
  title: { type: "plain_text"; text: string };
  submit: { type: "plain_text"; text: string };
  blocks: (KnownBlock | Block)[];
} {
  return {
    type: "modal",
    title: {
      type: "plain_text",
      text: `Resolve ${ticketNo}`,
    },
    submit: {
      type: "plain_text",
      text: "Resolve Ticket",
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `You are resolving ticket *${ticketNo}*. Please provide the following information.`,
        },
      },
      {
        type: "divider",
      },
      {
        type: "input",
        block_id: "customer_summary_block",
        element: {
          type: "plain_text_input",
          action_id: "customer_summary",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Clear summary of what was done and the outcome for the customer...",
          },
        },
        label: {
          type: "plain_text",
          text: "Customer Visible Summary *",
        },
      },
      {
        type: "input",
        block_id: "root_cause_block",
        element: {
          type: "static_select",
          action_id: "root_cause",
          placeholder: {
            type: "plain_text",
            text: "Select root cause category",
          },
          options: [
            { text: { type: "plain_text", text: "Hardware Failure" }, value: "hardware_failure" },
            { text: { type: "plain_text", text: "Software Bug" }, value: "software_bug" },
            { text: { type: "plain_text", text: "Configuration Error" }, value: "configuration_error" },
            { text: { type: "plain_text", text: "Network Issue" }, value: "network_issue" },
            { text: { type: "plain_text", text: "Sensor / Perception" }, value: "sensor_perception" },
            { text: { type: "plain_text", text: "Localization / Navigation" }, value: "localization_navigation" },
            { text: { type: "plain_text", text: "Mission / Task" }, value: "mission_task" },
            { text: { type: "plain_text", text: "Battery / Charging" }, value: "battery_charging" },
            { text: { type: "plain_text", text: "Mechanical / Wear" }, value: "mechanical_wear" },
            { text: { type: "plain_text", text: "Integration / WMS / WCS" }, value: "integration" },
            { text: { type: "plain_text", text: "Environmental" }, value: "environmental" },
            { text: { type: "plain_text", text: "User Error / Training" }, value: "user_error" },
            { text: { type: "plain_text", text: "Unknown" }, value: "unknown" },
          ],
        },
        label: {
          type: "plain_text",
          text: "Root Cause Category",
        },
      },
      {
        type: "input",
        block_id: "follow_up_block",
        element: {
          type: "radio_buttons",
          action_id: "follow_up",
          options: [
            { text: { type: "plain_text", text: "No follow-up needed" }, value: "no" },
            { text: { type: "plain_text", text: "Yes, follow-up needed" }, value: "yes" },
          ],
        },
        label: {
          type: "plain_text",
          text: "Follow-up Needed?",
        },
      },
      {
        type: "input",
        block_id: "internal_notes_block",
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "internal_notes",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Internal technical analysis (not visible to customer)...",
          },
        },
        label: {
          type: "plain_text",
          text: "Internal Notes",
        },
      },
    ],
  };
}
