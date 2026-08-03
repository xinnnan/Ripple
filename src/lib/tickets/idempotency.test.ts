import { describe, expect, it } from "vitest";
import {
  buildSlackTicketIdempotencyKey,
  generateTicketIdempotencyKey,
  normalizeTicketIdempotencyKey,
} from "./idempotency";

describe("ticket creation idempotency keys", () => {
  it("accepts bounded opaque keys and trims transport whitespace", () => {
    expect(normalizeTicketIdempotencyKey(`  ${"a".repeat(16)}  `)).toBe(
      "a".repeat(16)
    );
    expect(normalizeTicketIdempotencyKey("web:attempt_1234-abcd")).toBe(
      "web:attempt_1234-abcd"
    );
  });

  it("rejects missing, short, oversized, or unsafe keys", () => {
    expect(normalizeTicketIdempotencyKey(null)).toBeNull();
    expect(normalizeTicketIdempotencyKey("short")).toBeNull();
    expect(normalizeTicketIdempotencyKey("a".repeat(201))).toBeNull();
    expect(normalizeTicketIdempotencyKey("valid-length key")).toBeNull();
    expect(normalizeTicketIdempotencyKey("valid-length,key")).toBeNull();
  });

  it("generates UUID request keys for browser/API attempts", () => {
    expect(generateTicketIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("binds Slack replays to the stable submitted view id", () => {
    expect(buildSlackTicketIdempotencyKey("V0123456789ABCDEF")).toBe(
      "slack:view:V0123456789ABCDEF"
    );
    expect(() => buildSlackTicketIdempotencyKey("bad view id")).toThrow(
      "Invalid Slack view identifier"
    );
  });
});
