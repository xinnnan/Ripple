import { describe, it, expect } from "vitest";
import {
  parseFilters,
  parseTicketListFilters,
  buildParams,
  PAGE_SIZE,
} from "./ticket-filters";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";

describe("parseFilters", () => {
  it("returns an empty state for no params", () => {
    const f = parseFilters(new URLSearchParams());
    expect(f).toEqual({
      q: undefined,
      status: [],
      severity: [],
      customer_id: undefined,
      site_id: undefined,
      owner_id: undefined,
      range: undefined,
      page: 1,
    });
  });

  it("parses single-value status / severity", () => {
    const f = parseFilters(new URLSearchParams("status=new&severity=P1"));
    expect(f.status).toEqual(["new"]);
    expect(f.severity).toEqual(["P1"]);
  });

  it("parses multi-value status / severity (comma-separated)", () => {
    const f = parseFilters(
      new URLSearchParams("status=new,in_progress&severity=P1,P2")
    );
    expect(f.status).toEqual(["new", "in_progress"]);
    expect(f.severity).toEqual(["P1", "P2"]);
  });

  it("ignores blank values in comma lists", () => {
    const f = parseFilters(
      new URLSearchParams("status=new,,in_progress,")
    );
    expect(f.status).toEqual(["new", "in_progress"]);
  });

  it("parses customer / site / owner by their URL keys", () => {
    const f = parseFilters(
      new URLSearchParams(
        `customer=${CUSTOMER_ID}&site=${SITE_ID}&owner=${OWNER_ID}`
      )
    );
    expect(f.customer_id).toBe(CUSTOMER_ID);
    expect(f.site_id).toBe(SITE_ID);
    expect(f.owner_id).toBe(OWNER_ID);
  });

  it("accepts only the 4 known range values; rejects everything else", () => {
    expect(parseFilters(new URLSearchParams("range=7d")).range).toBe("7d");
    expect(parseFilters(new URLSearchParams("range=30d")).range).toBe("30d");
    expect(parseFilters(new URLSearchParams("range=90d")).range).toBe("90d");
    expect(parseFilters(new URLSearchParams("range=all")).range).toBe("all");
    expect(parseFilters(new URLSearchParams("range=bogus")).range).toBeUndefined();
  });

  it("clamps the page number to >= 1; defaults to 1", () => {
    expect(parseFilters(new URLSearchParams("page=2")).page).toBe(2);
    expect(parseFilters(new URLSearchParams("page=0")).page).toBe(1);
    expect(parseFilters(new URLSearchParams("page=-5")).page).toBe(1);
    expect(parseFilters(new URLSearchParams("page=abc")).page).toBe(1);
    expect(parseFilters(new URLSearchParams("")).page).toBe(1);
  });

  it("parses the search query", () => {
    expect(parseFilters(new URLSearchParams("q=AMR-03")).q).toBe("AMR-03");
  });

  it("deduplicates valid repeated list filters", () => {
    const result = parseTicketListFilters(
      new URLSearchParams("status=new&status=new,closed&severity=P1,P1")
    );
    expect(result).toEqual(
      expect.objectContaining({
        isValid: true,
        filters: expect.objectContaining({
          status: ["new", "closed"],
          severity: ["P1"],
        }),
      })
    );
  });

  it.each([
    "status=unknown",
    "status=new,unknown",
    "severity=P0",
    "customer=not-a-uuid",
    "site=not-a-uuid",
    "owner=not-a-uuid",
    "range=bogus",
    "sla=late",
    "page=2junk",
    "page=100001",
    "q=robot%2Coffline",
    "q=first&q=second",
    "unknown=value",
    `customer=${CUSTOMER_ID}&customer=${SITE_ID}`,
  ])("marks malformed or ambiguous filters invalid: %s", (query) => {
    expect(parseTicketListFilters(new URLSearchParams(query)).isValid).toBe(
      false
    );
  });
});

describe("buildParams", () => {
  it("returns empty string when nothing is set (no leading ?)", () => {
    expect(buildParams({})).toBe("");
  });

  it("encodes the search query", () => {
    expect(buildParams({ q: "hello world" })).toBe("?q=hello+world");
  });

  it("joins multi-status and multi-severity with commas", () => {
    expect(
      buildParams({ status: ["new", "in_progress"], severity: ["P1", "P2"] })
    ).toBe("?status=new%2Cin_progress&severity=P1%2CP2");
  });

  it("omits empty arrays (so we don't write ?status= with nothing)", () => {
    expect(buildParams({ status: [], severity: [] })).toBe("");
  });

  it("omits the page param when it's 1 (the first page is the default)", () => {
    expect(buildParams({ page: 1 })).toBe("");
  });

  it("includes page when > 1", () => {
    expect(buildParams({ page: 2 })).toBe("?page=2");
  });

  it("round-trips with parseFilters (except array ordering)", () => {
    const url = buildParams({
      q: "test",
      status: ["new", "in_progress"],
      severity: ["P1"],
      customer_id: CUSTOMER_ID,
      site_id: SITE_ID,
      owner_id: OWNER_ID,
      range: "7d",
      page: 3,
    });
    const parsed = parseFilters(new URLSearchParams(url.slice(1)));
    expect(parsed).toMatchObject({
      q: "test",
      status: ["new", "in_progress"],
      severity: ["P1"],
      customer_id: CUSTOMER_ID,
      site_id: SITE_ID,
      owner_id: OWNER_ID,
      range: "7d",
      page: 3,
    });
  });
});

describe("PAGE_SIZE", () => {
  it("is a positive number", () => {
    expect(PAGE_SIZE).toBeGreaterThan(0);
    expect(PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});
