import { describe, expect, it } from "vitest";
import {
  parseFieldServiceOrderListFilters,
  parseSiteListFilters,
  parseSparePartRequestListFilters,
} from "./resource-list-filters";

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";

describe("customer-capable resource list filters", () => {
  it("parses spare-part request filters", () => {
    expect(
      parseSparePartRequestListFilters(
        new URLSearchParams(
          `status=shipped&site_id=${SITE_ID}&ticket_id=${TICKET_ID}`
        )
      )
    ).toEqual({
      success: true,
      data: { status: "shipped", siteId: SITE_ID, ticketId: TICKET_ID },
    });
  });

  it.each([
    "status=unknown",
    "site_id=not-a-uuid",
    "ticket_id=not-a-uuid",
    "status=requested&status=approved",
    "service_type=repair",
  ])("rejects malformed spare-part filters: %s", (query) => {
    expect(
      parseSparePartRequestListFilters(new URLSearchParams(query)).success
    ).toBe(false);
  });

  it("parses field-service order filters", () => {
    expect(
      parseFieldServiceOrderListFilters(
        new URLSearchParams(
          `status=in_progress&site_id=${SITE_ID}&ticket_id=${TICKET_ID}&service_type=repair`
        )
      )
    ).toEqual({
      success: true,
      data: {
        status: "in_progress",
        siteId: SITE_ID,
        ticketId: TICKET_ID,
        serviceType: "repair",
      },
    });
  });

  it.each([
    "status=unknown",
    "site_id=not-a-uuid",
    "ticket_id=not-a-uuid",
    "service_type=unknown",
    "service_type=repair&service_type=inspection",
    "priority=urgent",
  ])("rejects malformed field-service filters: %s", (query) => {
    expect(
      parseFieldServiceOrderListFilters(new URLSearchParams(query)).success
    ).toBe(false);
  });

  it("parses a site customer filter", () => {
    expect(
      parseSiteListFilters(
        new URLSearchParams(`customer_id=${CUSTOMER_ID}`)
      )
    ).toEqual({ success: true, data: { customerId: CUSTOMER_ID } });
  });

  it.each([
    "customer_id=not-a-uuid",
    `customer_id=${CUSTOMER_ID}&customer_id=${SITE_ID}`,
    "status=active",
  ])("rejects malformed site filters: %s", (query) => {
    expect(parseSiteListFilters(new URLSearchParams(query)).success).toBe(
      false
    );
  });
});
