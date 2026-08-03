import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(
  "src/app/(auth)/dashboard/page.tsx",
  "utf8"
);

describe("dashboard time and count contracts", () => {
  it("renders every recent ticket in its own site timezone", () => {
    expect(dashboard.match(/site:sites\(site_name, timezone\)/g)).toHaveLength(3);
    expect(
      dashboard.match(/resolveSiteTimezone\(ticket\.site\)/g)
    ).toHaveLength(3);
    expect(dashboard.match(/singleRelation\(ticket\.site\)/g)).toHaveLength(3);
    expect(dashboard).not.toContain("ticket.site?.[0]?.site_name");
    expect(dashboard).not.toContain("formatDate(ticket.created_at)");
  });

  it("counts all customer tickets independently from the ten-row recent list", () => {
    expect(dashboard).toContain(
      "const [ticketsRes, openCountRes, totalCountRes] = await Promise.all(["
    );
    expect(dashboard).toContain("totalCount = totalCountRes.count ?? 0");
    expect(dashboard).toContain("{totalCount}");
    expect(dashboard).not.toContain(
      "recentTickets.length > 0 ? recentTickets.length : 0"
    );
  });

  it("limits the customer-manager dashboard to active organization sites", () => {
    expect(dashboard).toMatch(
      /\.eq\("customer_id", customerId\)\s*\.eq\("status", "active"\)/
    );
  });
});
