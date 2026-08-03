import { describe, expect, it } from "vitest";
import { getCurrentTab } from "./detail-tabs-helpers";

const TABS = ["overview", "tickets", "history"] as const;

describe("getCurrentTab", () => {
  it.each(["overview", "tickets", "history"] as const)(
    "accepts the declared %s tab",
    (tab) => {
      expect(getCurrentTab({ tab }, "overview", TABS)).toBe(tab);
    }
  );

  it.each([
    [undefined, "a missing value"],
    [{}, "an absent value"],
    [{ tab: "unknown" }, "an unknown value"],
    [{ tab: ["tickets", "history"] }, "a repeated value"],
  ])("uses the fallback for %s (%s)", (searchParams) => {
    expect(
      getCurrentTab(
        searchParams as { tab?: string | string[] } | undefined,
        "overview",
        TABS
      )
    ).toBe("overview");
  });
});
