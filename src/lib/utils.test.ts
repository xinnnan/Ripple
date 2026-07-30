import { describe, expect, it } from "vitest";
import { formatDateOnly } from "./utils";

describe("formatDateOnly", () => {
  it("formats a database DATE without crossing a timezone boundary", () => {
    expect(formatDateOnly("2026-07-29")).toBe("Jul 29, 2026");
  });

  it("leaves an unexpected value visible instead of inventing a date", () => {
    expect(formatDateOnly("not-a-date")).toBe("not-a-date");
    expect(formatDateOnly("2026-02-30")).toBe("2026-02-30");
  });
});
