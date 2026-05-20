import type { KnownBlock, Block } from "@slack/web-api";

export function buildTicketFormModal(): {
  type: "modal";
  title: { type: "plain_text"; text: string };
  submit: { type: "plain_text"; text: string };
  blocks: (KnownBlock | Block)[];
} {
  return {
    type: "modal",
    title: {
      type: "plain_text",
      text: "Create Support Ticket",
    },
    submit: {
      type: "plain_text",
      text: "Create Ticket",
    },
    blocks: [
      {
        type: "input",
        block_id: "title_block",
        element: {
          type: "plain_text_input",
          action_id: "title",
          placeholder: {
            type: "plain_text",
            text: "e.g. AMR-03 not completing delivery mission",
          },
        },
        label: {
          type: "plain_text",
          text: "Issue Title",
        },
      },
      {
        type: "input",
        block_id: "request_type_block",
        element: {
          type: "static_select",
          action_id: "request_type",
          placeholder: {
            type: "plain_text",
            text: "Select request type",
          },
          options: [
            {
              text: { type: "plain_text", text: "Incident" },
              value: "incident",
            },
            {
              text: { type: "plain_text", text: "Service Request" },
              value: "service_request",
            },
            {
              text: { type: "plain_text", text: "Question" },
              value: "question",
            },
            {
              text: { type: "plain_text", text: "Change Request" },
              value: "change_request",
            },
            {
              text: { type: "plain_text", text: "Parts / RMA" },
              value: "parts_rma",
            },
            {
              text: { type: "plain_text", text: "Deployment Issue" },
              value: "deployment_issue",
            },
            {
              text: { type: "plain_text", text: "Training / Documentation" },
              value: "training_documentation",
            },
          ],
        },
        label: {
          type: "plain_text",
          text: "Request Type",
        },
      },
      {
        type: "input",
        block_id: "severity_block",
        element: {
          type: "static_select",
          action_id: "severity",
          placeholder: {
            type: "plain_text",
            text: "Select severity",
          },
          options: [
            {
              text: {
                type: "plain_text",
                text: "P1 — Critical (Safety, production stopped)",
              },
              value: "P1",
            },
            {
              text: {
                type: "plain_text",
                text: "P2 — High (Production degraded)",
              },
              value: "P2",
            },
            {
              text: {
                type: "plain_text",
                text: "P3 — Normal (Single issue, workaround available)",
              },
              value: "P3",
            },
            {
              text: {
                type: "plain_text",
                text: "P4 — Low (Question, minor request)",
              },
              value: "P4",
            },
          ],
        },
        label: {
          type: "plain_text",
          text: "Severity",
        },
      },
      {
        type: "input",
        block_id: "impact_block",
        element: {
          type: "static_select",
          action_id: "impact",
          placeholder: {
            type: "plain_text",
            text: "Select production impact",
          },
          options: [
            {
              text: { type: "plain_text", text: "Safety concern" },
              value: "safety",
            },
            {
              text: { type: "plain_text", text: "Production stopped" },
              value: "production_stopped",
            },
            {
              text: { type: "plain_text", text: "Production slowed down" },
              value: "production_slowed",
            },
            {
              text: { type: "plain_text", text: "Single asset affected" },
              value: "single_asset",
            },
            {
              text: { type: "plain_text", text: "No production impact" },
              value: "no_impact",
            },
          ],
        },
        label: {
          type: "plain_text",
          text: "Production Impact",
        },
      },
      {
        type: "input",
        block_id: "description_block",
        element: {
          type: "plain_text_input",
          action_id: "description",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Describe the issue in detail...",
          },
        },
        label: {
          type: "plain_text",
          text: "Description",
        },
      },
      {
        type: "input",
        block_id: "asset_block",
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "asset_id",
          placeholder: {
            type: "plain_text",
            text: "e.g. AMR-03, Charger-01, RCS",
          },
        },
        label: {
          type: "plain_text",
          text: "Asset / Equipment ID",
        },
      },
      {
        type: "input",
        block_id: "area_block",
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "area",
          placeholder: {
            type: "plain_text",
            text: "e.g. Receiving, Line-side, Dock, Sorting",
          },
        },
        label: {
          type: "plain_text",
          text: "Area / Process",
        },
      },
    ],
  };
}
