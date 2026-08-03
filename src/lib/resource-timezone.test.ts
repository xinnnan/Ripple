import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const slackMaster = readFileSync(
  "src/lib/slack/blocks/ticket-master.ts",
  "utf8"
);
const outboxWorker = readFileSync("src/lib/tickets/outbox.ts", "utf8");
const ticketCreation = readFileSync("src/lib/tickets/create.ts", "utf8");
const slackActions = readFileSync(
  "src/lib/slack/handlers/actions.ts",
  "utf8"
);
const ticketDetail = readFileSync(
  "src/app/(auth)/tickets/[ticketId]/page.tsx",
  "utf8"
);

describe("resource-owned operational timezone contracts", () => {
  it("hydrates a site timezone at each Slack master-card rendering path", () => {
    const fullSiteProjection =
      "site:sites(id, site_name, site_code, slack_channel_id, timezone)";

    expect(outboxWorker).toContain(fullSiteProjection);
    expect(ticketCreation).not.toContain('.from("tickets")');
    expect(ticketCreation).toContain("dispatchTicketOutboxBestEffort");
    expect(slackActions).toContain("site:sites(site_name, site_code, timezone)");
    expect(slackMaster).toContain("resolveSiteTimezone(site)");
    expect(slackMaster).not.toContain("America/New_York");
    expect(slackMaster).not.toContain("} ET");
  });

  it("uses the same validated site-timezone fallback on ticket detail", () => {
    expect(ticketDetail).toContain(
      "const userTimezone = resolveSiteTimezone(ticket.site);"
    );
    expect(ticketDetail).not.toContain('||\n    "America/New_York"');
  });
});
