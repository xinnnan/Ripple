import { describe, it, expect } from "vitest";
import { isUuidLike, resolveTicketQuery } from "./lookup";

describe("isUuidLike", () => {
  it("accepts a canonical UUID", () => {
    expect(isUuidLike("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });
  it("accepts uppercase hex", () => {
    expect(isUuidLike("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });
  it("rejects a ticket_no", () => {
    expect(isUuidLike("RPL-000005")).toBe(false);
  });
  it("rejects an empty string", () => {
    expect(isUuidLike("")).toBe(false);
  });
  it("rejects a UUID missing a segment", () => {
    expect(isUuidLike("550e8400-e29b-41d4-a716-44665544")).toBe(false);
  });
  it("rejects a UUID with a non-hex char in the middle", () => {
    // 'g' isn't a hex digit, so this should be rejected
    expect(isUuidLike("550e8400-e29b-41d4-a716-44665544000g")).toBe(false);
  });
});

describe("resolveTicketQuery", () => {
  // Minimal mock of a Supabase PostgrestFilterBuilder. We only care
  // that `.eq()` is called with the right (column, value) pair.
  const makeQb = () => {
    const calls: { col: string; val: string }[] = [];
    return {
      eq(col: string, val: string) {
        calls.push({ col, val });
        return { _calls: calls, _lastEq: { col, val } };
      },
      _calls: calls,
    };
  };

  it("branches on .eq('id', …) for a UUID", () => {
    const qb = makeQb();
    resolveTicketQuery(qb, "550e8400-e29b-41d4-a716-446655440000");
    expect(qb._calls).toEqual([
      { col: "id", val: "550e8400-e29b-41d4-a716-446655440000" },
    ]);
  });

  it("branches on .eq('ticket_no', …) for a ticket_no", () => {
    const qb = makeQb();
    resolveTicketQuery(qb, "RPL-000005");
    expect(qb._calls).toEqual([{ col: "ticket_no", val: "RPL-000005" }]);
  });

  it("never produces an invalid-uuid cast (the bug it exists to prevent)", () => {
    const qb = makeQb();
    resolveTicketQuery(qb, "RPL-000007");
    // Critical: we must NOT have called eq('id', 'RPL-000007') —
    // that would produce 'invalid input syntax for type uuid'
    // against a real tickets.id column.
    expect(qb._calls.find((c) => c.col === "id" && c.val === "RPL-000007")).toBeUndefined();
  });
});
