import { describe, expect, it } from "vitest";
import { parseUuidRouteId } from "./request-identifiers";

describe("parseUuidRouteId", () => {
  it("accepts a canonical UUID", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(parseUuidRouteId(id)).toBe(id);
  });

  it.each([
    "",
    "not-a-uuid",
    "11111111-1111-4111-8111-11111111111",
    "11111111-1111-4111-8111-111111111111/extra",
  ])("rejects malformed route identifiers: %j", (value) => {
    expect(parseUuidRouteId(value)).toBeNull();
  });
});
