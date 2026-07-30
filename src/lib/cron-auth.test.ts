import { describe, expect, it } from "vitest";
import { hasValidCronAuthorization } from "./cron-auth";

describe("cron authorization", () => {
  it("accepts only the exact bearer token", () => {
    expect(hasValidCronAuthorization("Bearer durable-secret", "durable-secret"))
      .toBe(true);
    expect(hasValidCronAuthorization("Bearer wrong", "durable-secret"))
      .toBe(false);
    expect(hasValidCronAuthorization("Basic durable-secret", "durable-secret"))
      .toBe(false);
  });

  it("fails closed when configuration or the header is missing", () => {
    expect(hasValidCronAuthorization(null, "durable-secret")).toBe(false);
    expect(hasValidCronAuthorization("Bearer durable-secret", "")).toBe(false);
  });
});
