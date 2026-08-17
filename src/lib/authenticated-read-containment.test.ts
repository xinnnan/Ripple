import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INTERNAL_TICKET_API_SENSITIVE_SELECT } from "./resource-projections";

const ticketPage = readFileSync(
  "src/app/(auth)/tickets/[ticketId]/page.tsx",
  "utf8"
);
const sitesPage = readFileSync("src/app/(auth)/sites/page.tsx", "utf8");
const sitesRoute = readFileSync("src/app/api/sites/route.ts", "utf8");
const commentsRoute = readFileSync(
  "src/app/api/tickets/[ticketId]/comments/route.ts",
  "utf8"
);
const ticketRoute = readFileSync(
  "src/app/api/tickets/[ticketId]/route.ts",
  "utf8"
);

describe("authenticated customer read containment", () => {
  it("uses an external site projection for non-internal API callers", () => {
    expect(sitesRoute).toContain("scope.isInternal");
    expect(sitesRoute).toContain("EXTERNAL_SITE_SELECT");
    expect(sitesPage).not.toContain("slack_channel_id");
  });

  it("selects customer-safe comment attribution at the API boundary", () => {
    expect(commentsRoute).toContain("EXTERNAL_TICKET_COMMENT_SELECT");
    expect(commentsRoute).toContain("INTERNAL_TICKET_COMMENT_SELECT");
    expect(commentsRoute).not.toContain(
      '.select("*, author:users(full_name, email, role)")'
    );
    expect(commentsRoute).not.toContain(
      '.select("*, author:users(full_name, email)")'
    );
  });

  it("does not serialize internal summaries or staff ids to customer clients", () => {
    expect(ticketPage).toContain("EXTERNAL_TICKET_DETAIL_SELECT");
    expect(ticketPage).toContain("INTERNAL_TICKET_DETAIL_SELECT");
    expect(ticketPage).toContain(
      "isInternal ? ticket.internal_summary ?? null : null"
    );
    expect(ticketPage).toContain(
      "currentOwnerId={isInternal ? ticket.owner_id ?? null : null}"
    );
    expect(ticketPage).toContain(
      'currentUserId={isInternal ? currentUserId : ""}'
    );
  });

  it("restores the complete contact and diagnostic projection for internal API callers", () => {
    expect(ticketRoute).toContain("INTERNAL_TICKET_API_SENSITIVE_SELECT");
    for (const field of [
      "internal_summary",
      "root_cause_category",
      "follow_up_needed",
      "secure_token",
      "submitter_name",
      "submitter_email",
      "submitter_phone",
    ]) {
      expect(INTERNAL_TICKET_API_SENSITIVE_SELECT).toContain(field);
    }
  });

  it("uses explicit child-resource projections on ticket detail", () => {
    expect(ticketPage).toContain("TICKET_DETAIL_COMMENT_SELECT");
    expect(ticketPage).toContain("TICKET_DETAIL_ATTACHMENT_SELECT");
    expect(ticketPage).not.toMatch(
      /from\("ticket_(?:comments|attachments)"\)[\s\S]{0,100}\.select\("\*"\)/
    );
  });
});
