import type { KnownBlock, Block } from "@slack/web-api";

export function buildAskRippleAssistModal(ticketNo: string): {
  type: "modal";
  title: { type: "plain_text"; text: string };
  submit: { type: "plain_text"; text: string };
  callback_id: string;
  private_metadata: string;
  blocks: (KnownBlock | Block)[];
} {
  return {
    type: "modal",
    title: {
      type: "plain_text",
      text: "Ask Ripple Assist",
    },
    submit: {
      type: "plain_text",
      text: "Generate",
    },
    callback_id: "ripple_assist_submit",
    private_metadata: JSON.stringify({ ticket_no: ticketNo }),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `What do you want Ripple Assist to do for *${ticketNo}*?`,
        },
      },
      {
        type: "divider",
      },
      {
        type: "input",
        block_id: "task_type_block",
        element: {
          type: "radio_buttons",
          action_id: "task_type",
          options: [
            {
              text: { type: "plain_text", text: "📋 Summarize ticket" },
              value: "summary",
            },
            {
              text: { type: "plain_text", text: "🔧 Suggest troubleshooting steps" },
              value: "troubleshooting",
            },
            {
              text: { type: "plain_text", text: "🔍 Find similar tickets" },
              value: "similar_tickets",
            },
            {
              text: { type: "plain_text", text: "💬 Draft customer reply" },
              value: "customer_reply_draft",
            },
            {
              text: { type: "plain_text", text: "📝 Draft closure summary" },
              value: "closure_summary",
            },
            {
              text: { type: "plain_text", text: "📊 Analyze attachment/log" },
              value: "log_analysis",
            },
          ],
        },
        label: {
          type: "plain_text",
          text: "Select AI task",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "⚠️ AI output is internal-only. Always review before sharing with customers.",
          },
        ],
      },
    ],
  };
}
