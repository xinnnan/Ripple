import { describe, expect, it } from "vitest";
import {
  generateIdempotencyKey,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  normalizeIdempotencyKey,
} from "./idempotency";

describe("shared idempotency-key contract", () => {
  it("uses one bounded opaque transport contract", () => {
    expect(IDEMPOTENCY_KEY_HEADER).toBe("Idempotency-Key");
    expect(IDEMPOTENCY_KEY_MIN_LENGTH).toBe(16);
    expect(IDEMPOTENCY_KEY_MAX_LENGTH).toBe(200);
    expect(normalizeIdempotencyKey(`  ${"a".repeat(16)}  `)).toBe(
      "a".repeat(16)
    );
    expect(normalizeIdempotencyKey("service:create_1234-abcd")).toBe(
      "service:create_1234-abcd"
    );
  });

  it("rejects absent, short, oversized, and unsafe keys", () => {
    expect(normalizeIdempotencyKey(undefined)).toBeNull();
    expect(normalizeIdempotencyKey("short")).toBeNull();
    expect(normalizeIdempotencyKey("a".repeat(201))).toBeNull();
    expect(normalizeIdempotencyKey("service create 1234")).toBeNull();
  });

  it("generates UUID attempt keys", () => {
    expect(generateIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});
