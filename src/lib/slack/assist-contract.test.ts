import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAskRippleAssistModal } from "./blocks/ai-modal";

describe("Slack Ripple Assist contract", () => {
  it("preserves delivery context in modal metadata", () => {
    const modal = buildAskRippleAssistModal("RPL-000123", {
      channelId: "C123",
      messageTs: "123.456",
    });

    expect(JSON.parse(modal.private_metadata)).toEqual({
      ticket_no: "RPL-000123",
      channel_id: "C123",
      message_ts: "123.456",
    });
  });

  it("uses the shared domain service instead of cookie-bound internal HTTP", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/slack/handlers/actions.ts"),
      "utf8"
    );

    expect(source).toContain("await requestAiSuggestion({");
    expect(source).toContain("actorId: internalUser!.id");
    expect(source).not.toContain("/api/ai/suggest");
    expect(source).not.toContain("NEXT_PUBLIC_APP_URL");
  });
});
