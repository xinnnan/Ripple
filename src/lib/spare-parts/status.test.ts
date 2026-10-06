import { describe, expect, it } from "vitest";
import type { SPRStatus } from "@/types/spare-parts";
import {
  SPARE_PART_REQUEST_TRANSITIONS,
  canTransitionSparePartRequest,
  sparePartRequestTransitionRequiresAdmin,
} from "./status";

const STATUSES: SPRStatus[] = [
  "requested",
  "approved",
  "shipped",
  "delivered",
  "cancelled",
];

const ALLOWED = new Set([
  "requested>approved",
  "requested>cancelled",
  "approved>shipped",
  "approved>cancelled",
  "shipped>delivered",
]);

describe("spare part request workflow", () => {
  it.each(STATUSES.flatMap((from) => STATUSES.map((to) => [from, to] as const)))(
    "%s -> %s matches the database truth table",
    (from, to) => {
      expect(canTransitionSparePartRequest(from, to)).toBe(
        from === to || ALLOWED.has(`${from}>${to}`)
      );
    }
  );

  it("keeps delivered and cancelled terminal", () => {
    expect(SPARE_PART_REQUEST_TRANSITIONS.delivered).toEqual([]);
    expect(SPARE_PART_REQUEST_TRANSITIONS.cancelled).toEqual([]);
  });

  it("reserves approval for administrators", () => {
    expect(sparePartRequestTransitionRequiresAdmin("requested", "approved")).toBe(true);
    expect(sparePartRequestTransitionRequiresAdmin("approved", "approved")).toBe(false);
    expect(sparePartRequestTransitionRequiresAdmin("approved", "shipped")).toBe(false);
  });
});
