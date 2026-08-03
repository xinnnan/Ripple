import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateOnly,
  resolveSiteTimezone,
  singleRelation,
} from "./utils";

describe("formatDate", () => {
  const instant = "2026-01-01T04:30:00.000Z";

  it("uses UTC by default instead of the server host timezone", () => {
    const formatted = formatDate(instant);

    expect(formatted).toContain("Jan 1, 2026");
    expect(formatted).toContain("UTC");
  });

  it("formats an instant in the explicit site timezone", () => {
    const formatted = formatDate(instant, "America/Los_Angeles");

    expect(formatted).toContain("Dec 31, 2025");
    expect(formatted).toMatch(/PST|GMT-8/);
  });
});

describe("resolveSiteTimezone", () => {
  it("accepts Supabase object and array relationship shapes", () => {
    expect(resolveSiteTimezone({ timezone: "Asia/Shanghai" })).toBe(
      "Asia/Shanghai"
    );
    expect(resolveSiteTimezone([{ timezone: "America/Chicago" }])).toBe(
      "America/Chicago"
    );
  });

  it("falls back to UTC for missing or invalid legacy values", () => {
    expect(resolveSiteTimezone(null)).toBe("UTC");
    expect(resolveSiteTimezone([])).toBe("UTC");
    expect(resolveSiteTimezone({ timezone: "Not/A_Timezone" })).toBe("UTC");
  });
});

describe("singleRelation", () => {
  const site = { site_name: "Assembly", timezone: "America/Chicago" };

  it("normalizes Supabase object and array relationship shapes", () => {
    expect(singleRelation(site)).toEqual(site);
    expect(singleRelation([site])).toEqual(site);
  });

  it("returns undefined for empty relationships", () => {
    expect(singleRelation(null)).toBeUndefined();
    expect(singleRelation([])).toBeUndefined();
  });
});

describe("formatDateOnly", () => {
  it("formats a database DATE without crossing a timezone boundary", () => {
    expect(formatDateOnly("2026-07-29")).toBe("Jul 29, 2026");
  });

  it("leaves an unexpected value visible instead of inventing a date", () => {
    expect(formatDateOnly("not-a-date")).toBe("not-a-date");
    expect(formatDateOnly("2026-02-30")).toBe("2026-02-30");
  });
});
