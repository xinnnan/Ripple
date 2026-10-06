import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicSubmit = readFileSync("src/app/(public)/submit/page.tsx", "utf8");
const createModal = readFileSync(
  "src/app/(auth)/tickets/create-ticket-modal.tsx",
  "utf8"
);
const ticketsHeader = readFileSync(
  "src/app/(auth)/tickets/tickets-page-header.tsx",
  "utf8"
);
const actionsPanel = readFileSync(
  "src/app/(auth)/tickets/[ticketId]/ticket-actions-panel.tsx",
  "utf8"
);

describe("ticket mutation UI integrity", () => {
  it("keeps authenticated creation settled without timed full reloads", () => {
    expect(createModal).toContain("readClientJsonResponse");
    expect(createModal).toContain("if (submitting) return");
    expect(createModal).toContain("site_id: site.site_id");
    expect(createModal).toContain("aria-busy={submitting}");
    expect(createModal).not.toContain("setTimeout");
    expect(ticketsHeader).toContain("router.refresh()");
    expect(ticketsHeader).not.toContain("window.location.reload");
    expect(createModal).toContain("creationAttemptRef");
    expect(createModal).toContain("TICKET_IDEMPOTENCY_KEY_HEADER");
  });

  it("normalizes and bounds both ticket creation surfaces", () => {
    for (const source of [publicSubmit, createModal]) {
      expect(source).toContain("TICKET_TITLE_MAX_LENGTH");
      expect(source).toContain("TICKET_DESCRIPTION_MAX_LENGTH");
      expect(source).toContain("TICKET_CONTEXT_MAX_LENGTH");
      expect(source).toContain(".trim()");
    }
    expect(publicSubmit).toContain("TICKET_SUBMITTER_EMAIL_MAX_LENGTH");
    expect(publicSubmit).toContain("MAX_TICKET_SUBMISSION_ATTACHMENTS");
    expect(publicSubmit).toContain("MAX_ATTACHMENT_BYTES");
    expect(publicSubmit).toContain("creationAttemptRef");
  });

  it("contains returned and unexpected ticket action failures", () => {
    expect(createModal).toContain("clientMutationErrorMessage");
    expect(actionsPanel).toContain("localizedClientMutationError");
    for (const source of [publicSubmit, createModal, actionsPanel]) {
      expect(source).not.toContain("err instanceof Error ? err.message");
    }
    // Translated intake: unexpected failures never surface raw exception text.
    expect(publicSubmit).toContain("function submissionErrorMessage");
    expect(publicSubmit).toContain('return t("errors.unavailable")');
    expect(actionsPanel).toContain("assertClientMutationResponse");
  });

  it("locks detail mutations through route refresh and binds their controls", () => {
    // Update, resolve, customer reopen, comment, and attachment forms.
    expect(actionsPanel.match(/const busy =/g)).toHaveLength(5);
    expect(actionsPanel).toContain('htmlFor="ticket-reopen-reason"');
    expect(actionsPanel).toContain("if (busy) return");
    expect(actionsPanel).toContain('htmlFor="ticket-update-status"');
    expect(actionsPanel).toContain('htmlFor="resolve-customer-summary"');
    expect(actionsPanel).toContain('htmlFor="ticket-comment-visibility"');
    expect(actionsPanel).toContain('htmlFor="ticket-attachment-visibility"');
    expect(actionsPanel).toContain("TICKET_COMMENT_MAX_LENGTH");
    expect(actionsPanel).toContain("TICKET_SUMMARY_MAX_LENGTH");
    expect(actionsPanel).toContain("commentAttemptRef");
    expect(actionsPanel).toContain("TICKET_IDEMPOTENCY_KEY_HEADER");
  });
});
