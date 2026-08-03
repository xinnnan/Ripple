import { describe, expect, it } from "vitest";
import {
  isValidSiteCode,
  normalizeSiteCode,
  SITE_CODE_MAX_LENGTH,
} from "./site-code";

describe("site-code contract", () => {
  it("normalizes surrounding whitespace and case", () => {
    expect(normalizeSiteCode("  adi-indy-001 ")).toBe("ADI-INDY-001");
  });

  it("accepts the shared admin/public shape", () => {
    expect(isValidSiteCode("A")).toBe(true);
    expect(isValidSiteCode("ADI-INDY-001")).toBe(true);
  });

  it("rejects separators, control characters, and oversized values", () => {
    expect(isValidSiteCode("ADI INDY")).toBe(false);
    expect(isValidSiteCode("ADI_INDY")).toBe(false);
    expect(isValidSiteCode("-ADI")).toBe(false);
    expect(isValidSiteCode(`A${"1".repeat(SITE_CODE_MAX_LENGTH)}`)).toBe(
      false
    );
  });
});
