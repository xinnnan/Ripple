import { describe, expect, it } from "vitest";
import { parseTicketApiListFilters } from "./api-list-filters";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";

describe("parseTicketApiListFilters", () => {
  it("applies a bounded default limit", () => {
    expect(parseTicketApiListFilters(new URLSearchParams())).toEqual({
      success: true,
      data: {
        status: undefined,
        severity: undefined,
        customerId: undefined,
        siteId: undefined,
        limit: 50,
      },
    });
  });

  it("parses the complete API list contract", () => {
    expect(
      parseTicketApiListFilters(
        new URLSearchParams(
          `status=in_progress&severity=P2&customer_id=${CUSTOMER_ID}&site_id=${SITE_ID}&limit=200`
        )
      )
    ).toEqual({
      success: true,
      data: {
        status: "in_progress",
        severity: "P2",
        customerId: CUSTOMER_ID,
        siteId: SITE_ID,
        limit: 200,
      },
    });
  });

  it.each([
    "status=unknown",
    "severity=P0",
    "customer_id=not-a-uuid",
    "site_id=not-a-uuid",
    "limit=0",
    "limit=-1",
    "limit=2junk",
    "limit=201",
    "status=new&status=closed",
    "owner_id=33333333-3333-4333-8333-333333333333",
  ])("rejects malformed or ambiguous filters: %s", (query) => {
    expect(
      parseTicketApiListFilters(new URLSearchParams(query)).success
    ).toBe(false);
  });
});
