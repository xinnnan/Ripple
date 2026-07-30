import { type KnownBlock, type Block } from "@slack/web-api";
import type { Ticket, Severity, TicketStatus } from "@/types/ticket";
import { STATUS_LABELS, SEVERITY_LABELS } from "@/types/ticket";
import {
  canTransitionTicketStatus,
  ticketStatusAcceptsAssignment,
} from "@/lib/tickets/status";

function getSeverityEmoji(severity: Severity): string {
  switch (severity) {
    case "P1":
      return "🔴";
    case "P2":
      return "🟠";
    case "P3":
      return "🟡";
    case "P4":
      return "🟢";
  }
}

function getStatusEmoji(status: TicketStatus): string {
  switch (status) {
    case "new":
      return "🆕";
    case "assigned":
      return "👤";
    case "in_progress":
      return "🔧";
    case "waiting_customer":
      return "⏳";
    case "waiting_droplet":
      return "⏸️";
    case "resolved":
      return "✅";
    case "closed":
      return "🏁";
    case "reopened":
      return "🔄";
  }
}

export function buildMasterTicketMessage(ticket: Ticket): (KnownBlock | Block)[] {
  const severityEmoji = getSeverityEmoji(ticket.severity);
  const statusEmoji = getStatusEmoji(ticket.status);

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${severityEmoji} [${ticket.ticket_no}] ${ticket.title}`,
        emoji: true,
      },
    },
    {
      type: "divider",
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Customer:*\n${ticket.customer?.name || "N/A"}`,
        },
        {
          type: "mrkdwn",
          text: `*Site:*\n${ticket.site?.site_name || "N/A"}`,
        },
        {
          type: "mrkdwn",
          text: `*Status:* ${statusEmoji}\n${STATUS_LABELS[ticket.status]}`,
        },
        {
          type: "mrkdwn",
          text: `*Owner:*\n${ticket.owner?.full_name || "Unassigned"}`,
        },
        {
          type: "mrkdwn",
          text: `*Severity:*\n${SEVERITY_LABELS[ticket.severity]}`,
        },
        {
          type: "mrkdwn",
          text: `*Source:*\n${ticket.source}`,
        },
      ],
    },
    ...(ticket.asset_id
      ? [
          {
            type: "section" as const,
            fields: [
              {
                type: "mrkdwn" as const,
                text: `*Asset / Equipment:*\n${ticket.asset_id}`,
              },
              {
                type: "mrkdwn" as const,
                text: `*Area / Process:*\n${ticket.area || "N/A"}`,
              },
            ],
          },
        ]
      : []),
    ...(ticket.impact
      ? [
          {
            type: "section" as const,
            text: {
              type: "plain_text" as const,
              text: `Impact: ${ticket.impact.replace(/_/g, " ")}`,
            },
          },
        ]
      : []),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Created: ${new Date(ticket.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET`,
        },
        {
          type: "mrkdwn",
          text: `| Updated: ${new Date(ticket.updated_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET`,
        },
      ],
    },
    {
      type: "divider",
    },
    {
      type: "actions",
      elements: [
        ...(ticketStatusAcceptsAssignment(ticket.status)
          ? [
              {
                type: "button" as const,
                text: { type: "plain_text" as const, text: "Assign to Me" },
                action_id: "assign_to_me",
                style: "primary" as const,
                value: ticket.ticket_no,
              },
            ]
          : []),
        ...(canTransitionTicketStatus(ticket.status, "in_progress")
          ? [
              {
                type: "button" as const,
                text: { type: "plain_text" as const, text: "In Progress" },
                action_id: "mark_in_progress",
                value: ticket.ticket_no,
              },
            ]
          : []),
        ...(canTransitionTicketStatus(ticket.status, "waiting_customer")
          ? [
              {
                type: "button" as const,
                text: { type: "plain_text" as const, text: "Request Info" },
                action_id: "request_info",
                value: ticket.ticket_no,
              },
            ]
          : []),
        {
          type: "button",
          text: { type: "plain_text", text: "Customer Update" },
          action_id: "customer_update",
          value: ticket.ticket_no,
        },
        ...(canTransitionTicketStatus(ticket.status, "resolved")
          ? [
              {
                type: "button" as const,
                text: { type: "plain_text" as const, text: "Resolve" },
                action_id: "resolve_ticket",
                style: "danger" as const,
                value: ticket.ticket_no,
              },
            ]
          : []),
      ],
    },
  ];
}

export function buildTicketCreatedMessage(
  ticket: Ticket
): (KnownBlock | Block)[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🎫 *New Support Ticket Created*`,
      },
    },
    ...buildMasterTicketMessage(ticket),
  ];
}
