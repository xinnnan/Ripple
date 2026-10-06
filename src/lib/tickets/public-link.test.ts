import { describe, expect, it } from "vitest";
import { buildPublicTicketPath } from "./public-link";

describe("buildPublicTicketPath", () => {
  it("addresses the share page by ticket number with the token as a query", () => {
    expect(buildPublicTicketPath("RPL-000123", "a".repeat(64))).toBe(
      `/t/RPL-000123?token=${"a".repeat(64)}`
    );
  });

  it("encodes both components", () => {
    expect(buildPublicTicketPath("RPL/1?x", "t&k=v")).toBe(
      "/t/RPL%2F1%3Fx?token=t%26k%3Dv"
    );
  });
});
