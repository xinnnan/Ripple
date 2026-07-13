import { describe, it, expect } from "vitest";
import { parseFilters, buildParams, PAGE_SIZE } from "./ticket-filters";

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
      new URLSearchParams("customer=c1&site=s1&owner=u1")
    );
    expect(f.customer_id).toBe("c1");
    expect(f.site_id).toBe("s1");
    expect(f.owner_id).toBe("u1");
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
      customer_id: "c1",
      site_id: "s1",
      owner_id: "u1",
      range: "7d",
      page: 3,
    });
    const parsed = parseFilters(new URLSearchParams(url.slice(1)));
    expect(parsed).toMatchObject({
      q: "test",
      status: ["new", "in_progress"],
      severity: ["P1"],
      customer_id: "c1",
      site_id: "s1",
      owner_id: "u1",
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
