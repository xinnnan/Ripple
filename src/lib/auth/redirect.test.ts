import { describe, expect, it } from "vitest";
import { getSafeRedirectPath } from "./redirect";

describe("getSafeRedirectPath", () => {
  it("keeps an internal path and its query string", () => {
    expect(getSafeRedirectPath("/tickets?status=new")).toBe(
      "/tickets?status=new"
    );
  });

  it("uses the fallback for missing values", () => {
    expect(getSafeRedirectPath(null)).toBe("/dashboard");
    expect(getSafeRedirectPath(undefined, "/login")).toBe("/login");
  });

  it.each([
    "https://attacker.example/path",
    "//attacker.example/path",
    "/\\attacker.example/path",
    "dashboard",
    "/tickets\u0000",
  ])("rejects unsafe redirect value %j", (value) => {
    expect(getSafeRedirectPath(value)).toBe("/dashboard");
  });
});
