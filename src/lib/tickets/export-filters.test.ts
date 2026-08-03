import { describe, expect, it } from "vitest";
import { parseTicketExportFilters } from "./export-filters";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";

describe("ticket export filters", () => {
  it("parses the canonical ticket-list query contract", () => {
    const result = parseTicketExportFilters(
      new URLSearchParams({
        q: "AMR alarm",
        status: "new,in_progress",
        severity: "P1,P2",
        customer: CUSTOMER_ID,
        site: SITE_ID,
        owner: OWNER_ID,
        range: "30d",
        sla: "breached",
      })
    );

    expect(result).toEqual({
      success: true,
      data: {
        q: "AMR alarm",
        status: ["new", "in_progress"],
        severity: ["P1", "P2"],
        customerId: CUSTOMER_ID,
        siteId: SITE_ID,
        ownerId: OWNER_ID,
        range: "30d",
        sla: "breached",
      },
    });
  });

  it("accepts legacy aliases only when they do not conflict", () => {
    expect(
      parseTicketExportFilters(
        new URLSearchParams({ customer_id: CUSTOMER_ID, site_id: SITE_ID })
      ).success
    ).toBe(true);
    expect(
      parseTicketExportFilters(
        new URLSearchParams({
          customer: CUSTOMER_ID,
          customer_id: SITE_ID,
        })
      ).success
    ).toBe(false);
  });

  it.each([
    "status=bogus",
    "severity=P0",
    "customer=not-a-uuid",
    "site=not-a-uuid",
    "owner=not-a-uuid",
    "range=365d",
    "sla=late",
    "q=alarm%2Cstatus.eq.closed",
    "q=alarm%29",
    "q=first&q=second",
    "unknown=value",
    "date_from=not-a-date",
    "date_from=2026-08-04&date_to=2026-08-03",
    "range=7d&date_from=2026-08-01",
  ])("rejects malformed filters: %s", (query) => {
    expect(parseTicketExportFilters(new URLSearchParams(query)).success).toBe(
      false
    );
  });

  it("rejects conflicting owner aliases", () => {
    expect(
      parseTicketExportFilters(
        new URLSearchParams({ owner: OWNER_ID, owner_id: SITE_ID })
      ).success
    ).toBe(false);
  });
});
