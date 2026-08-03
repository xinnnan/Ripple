import { describe, expect, it, vi } from "vitest";
import { assertPageQueriesSucceeded } from "./server-page-query";

describe("assertPageQueriesSucceeded", () => {
  it("allows successful and missing-safe query results", () => {
    expect(() =>
      assertPageQueriesSucceeded(
        "admin/example",
        { error: null },
        { error: null }
      )
    ).not.toThrow();
  });

  it("logs only stable codes and throws a generic page error", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const sensitiveError = {
      code: "XX000",
      message: "sensitive database detail",
      details: "private query text",
    };

    expect(() =>
      assertPageQueriesSucceeded(
        "admin/example",
        { error: sensitiveError },
        { error: { message: "another sensitive detail" } }
      )
    ).toThrow("Page data is temporarily unavailable");
    expect(consoleError).toHaveBeenCalledWith(
      "[admin/example] query failed:",
      { codes: ["XX000", "UNKNOWN"] }
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "sensitive database detail"
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "private query text"
    );
    consoleError.mockRestore();
  });
});
