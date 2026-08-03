import { describe, expect, it } from "vitest";
import {
  buildAdminSparePartSearchFilter,
  parseAdminAuditListFilters,
  parseAdminAuditPageFilters,
  parseAdminInventoryPageFilters,
  parseAdminInventoryListFilters,
  parseAdminSiteMemberListFilters,
  parseAdminSparePartListFilters,
} from "./admin-list-filters";

const ID = "11111111-1111-4111-8111-111111111111";

describe("admin list filters", () => {
  it("parses the audit contract with a bounded default", () => {
    expect(
      parseAdminAuditListFilters(
        new URLSearchParams(`entity_type=ticket&action=updated&actor_id=${ID}`)
      )
    ).toEqual({
      success: true,
      data: {
        entityType: "ticket",
        action: "updated",
        actorId: ID,
        limit: 50,
      },
    });
  });

  it.each([
    "entity_type=unknown",
    "action=unknown",
    "actor_id=not-a-uuid",
    "limit=0",
    "limit=2junk",
    "limit=201",
    "limit=20&limit=30",
    "page=2",
  ])("rejects malformed audit filters: %s", (query) => {
    expect(parseAdminAuditListFilters(new URLSearchParams(query)).success).toBe(
      false
    );
  });

  it("parses the inventory page's canonical site prefilter", () => {
    expect(
      parseAdminInventoryPageFilters(new URLSearchParams(`site=${ID}`))
    ).toEqual({ success: true, data: { siteId: ID } });
    expect(parseAdminInventoryPageFilters(new URLSearchParams())).toEqual({
      success: true,
      data: { siteId: undefined },
    });
  });

  it.each([
    "site=not-a-uuid",
    `site=${ID}&site=22222222-2222-4222-8222-222222222222`,
    `site_id=${ID}`,
    "unexpected=value",
  ])("rejects malformed inventory-page filters: %s", (query) => {
    expect(
      parseAdminInventoryPageFilters(new URLSearchParams(query)).success
    ).toBe(false);
  });

  it("parses bounded audit-page filters independently of the API limit", () => {
    expect(
      parseAdminAuditPageFilters(
        new URLSearchParams(
          `entity_type=site&action=archived&actor_id=${ID}&page=2`
        )
      )
    ).toEqual({
      success: true,
      data: {
        entityType: "site",
        action: "archived",
        actorId: ID,
        page: 2,
      },
    });
    expect(parseAdminAuditPageFilters(new URLSearchParams())).toEqual({
      success: true,
      data: {
        entityType: undefined,
        action: undefined,
        actorId: undefined,
        page: 1,
      },
    });
  });

  it.each([
    "entity_type=unknown",
    "action=unknown",
    "actor_id=not-a-uuid",
    "page=0",
    "page=2junk",
    "page=10001",
    "page=1&page=2",
    "limit=50",
  ])("rejects malformed audit-page filters: %s", (query) => {
    expect(parseAdminAuditPageFilters(new URLSearchParams(query)).success).toBe(
      false
    );
  });

  it("parses inventory site and both low-stock states", () => {
    expect(
      parseAdminInventoryListFilters(
        new URLSearchParams(`site_id=${ID}&low_stock=true`)
      )
    ).toEqual({ success: true, data: { siteId: ID, lowStock: true } });
    expect(
      parseAdminInventoryListFilters(new URLSearchParams("low_stock=false"))
    ).toEqual({
      success: true,
      data: { siteId: undefined, lowStock: false },
    });
  });

  it.each([
    "site_id=not-a-uuid",
    "low_stock=yes",
    "low_stock=true&low_stock=false",
    "limit=10",
  ])("rejects malformed inventory filters: %s", (query) => {
    expect(
      parseAdminInventoryListFilters(new URLSearchParams(query)).success
    ).toBe(false);
  });

  it("parses site-member filters and their larger bound", () => {
    expect(
      parseAdminSiteMemberListFilters(
        new URLSearchParams(`site_id=${ID}&limit=500`)
      )
    ).toEqual({ success: true, data: { siteId: ID, limit: 500 } });
  });

  it.each([
    "site_id=not-a-uuid",
    "limit=-1",
    "limit=501",
    "limit=10x",
    "site_id=11111111-1111-4111-8111-111111111111&site_id=22222222-2222-4222-8222-222222222222",
    "user_id=11111111-1111-4111-8111-111111111111",
  ])("rejects malformed site-member filters: %s", (query) => {
    expect(
      parseAdminSiteMemberListFilters(new URLSearchParams(query)).success
    ).toBe(false);
  });

  it("parses spare-part catalog filters", () => {
    expect(
      parseAdminSparePartListFilters(
        new URLSearchParams("category=sensor&active=false&search=AMR_100%25")
      )
    ).toEqual({
      success: true,
      data: { category: "sensor", active: false, search: "AMR_100%" },
    });
  });

  it.each([
    "category=unknown",
    "active=yes",
    "search=robot%2Ccontroller",
    "search=first&search=second",
    "search=" + "a".repeat(101),
    "limit=10",
  ])("rejects malformed spare-part filters: %s", (query) => {
    expect(
      parseAdminSparePartListFilters(new URLSearchParams(query)).success
    ).toBe(false);
  });

  it("escapes wildcard characters in the guarded spare-part search", () => {
    expect(buildAdminSparePartSearchFilter("AMR_100%"))
      .toBe("part_number.ilike.%AMR\\_100\\%%,part_name.ilike.%AMR\\_100\\%%");
    expect(() => buildAdminSparePartSearchFilter("robot,controller")).toThrow(
      "Invalid spare part search value"
    );
  });
});
