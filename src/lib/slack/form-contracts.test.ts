import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TICKET_CONTEXT_MAX_LENGTH,
  TICKET_TITLE_MAX_LENGTH,
} from "@/lib/tickets/input-contract";
import { buildResolveModal } from "./blocks/resolve-modal";
import { buildTicketFormModal } from "./blocks/ticket-form";

function inputElement(
  blocks: ReturnType<typeof buildTicketFormModal>["blocks"],
  blockId: string
) {
  const block = blocks.find(
    (candidate) => "block_id" in candidate && candidate.block_id === blockId
  );
  if (!block || !("element" in block)) {
    throw new Error(`Missing input block ${blockId}`);
  }
  return block.element as { max_length?: number };
}

describe("Slack mutation form contracts", () => {
  it("bounds every free-text ticket input at the Slack surface", () => {
    const modal = buildTicketFormModal();

    expect(inputElement(modal.blocks, "title_block").max_length).toBe(
      TICKET_TITLE_MAX_LENGTH
    );
    expect(inputElement(modal.blocks, "description_block").max_length).toBe(
      3_000
    );
    expect(inputElement(modal.blocks, "asset_block").max_length).toBe(
      TICKET_CONTEXT_MAX_LENGTH
    );
    expect(inputElement(modal.blocks, "area_block").max_length).toBe(
      TICKET_CONTEXT_MAX_LENGTH
    );
  });

  it("bounds both resolution text areas to Slack's supported limit", () => {
    const modal = buildResolveModal("RPL-000123");

    expect(
      inputElement(modal.blocks, "customer_summary_block").max_length
    ).toBe(3_000);
    expect(inputElement(modal.blocks, "internal_notes_block").max_length).toBe(
      3_000
    );
  });

  it("validates signed submissions and avoids post-commit hydration", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/slack/handlers/actions.ts"),
      "utf8"
    );

    expect(source).toContain("TICKET_TITLE_MAX_LENGTH");
    expect(source).toContain("TICKET_COMMENT_MAX_LENGTH");
    expect(source).toContain("TICKET_SUMMARY_MAX_LENGTH");
    expect(source).toContain("response_action: \"errors\"");
    expect(source).not.toContain("Slack ticket refresh failed");
    expect(source).not.toContain("SLACK_TICKET_SELECT");
  });
});
