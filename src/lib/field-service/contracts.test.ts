import { describe, expect, it } from "vitest";
import {
  createFieldServiceOrderSchema,
  isValidDateOnly,
  updateFieldServiceOrderSchema,
} from "./contracts";

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const ENGINEER_ID = "22222222-2222-4222-8222-222222222222";

describe("field service HTTP contracts", () => {
  it("accepts browser date-input values without coercing them to instants", () => {
    const parsed = createFieldServiceOrderSchema.parse({
      site_id: SITE_ID,
      service_type: "repair",
      title: "Repair conveyor",
      scheduled_date: "2026-07-29",
      scheduled_end_date: "2026-07-30",
    });

    expect(parsed.scheduled_date).toBe("2026-07-29");
    expect(parsed.scheduled_end_date).toBe("2026-07-30");
    expect(parsed.travel_required).toBe(true);
    expect(parsed.engineers).toEqual([]);
  });

  it.each([
    "2026-07-29T00:00:00.000Z",
    "07/29/2026",
    "2026-02-29",
    "2026-13-01",
    "0000-01-01",
  ])("rejects non-DATE value %s", (value) => {
    expect(isValidDateOnly(value)).toBe(false);
  });

  it("accepts a real leap day", () => {
    expect(isValidDateOnly("2028-02-29")).toBe(true);
  });

  it("rejects a reversed schedule when both dates are supplied", () => {
    const result = createFieldServiceOrderSchema.safeParse({
      site_id: SITE_ID,
      service_type: "inspection",
      title: "Inspect sorter",
      scheduled_date: "2026-08-02",
      scheduled_end_date: "2026-08-01",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["scheduled_end_date"]);
    }
  });

  it("rejects duplicate engineers and unsupported assignment roles", () => {
    const duplicate = createFieldServiceOrderSchema.safeParse({
      site_id: SITE_ID,
      service_type: "maintenance",
      title: "Maintain AMRs",
      engineers: [
        { engineer_id: ENGINEER_ID, role: "lead" },
        { engineer_id: ENGINEER_ID, role: "engineer" },
      ],
    });
    const invalidRole = createFieldServiceOrderSchema.safeParse({
      site_id: SITE_ID,
      service_type: "maintenance",
      title: "Maintain AMRs",
      engineers: [{ engineer_id: ENGINEER_ID, role: "manager" }],
    });

    expect(duplicate.success).toBe(false);
    expect(invalidRole.success).toBe(false);
  });

  it("rejects unknown create, update, and assignment fields", () => {
    expect(
      createFieldServiceOrderSchema.safeParse({
        site_id: SITE_ID,
        service_type: "maintenance",
        title: "Maintain AMRs",
        requested_by: ENGINEER_ID,
      }).success
    ).toBe(false);
    expect(
      createFieldServiceOrderSchema.safeParse({
        site_id: SITE_ID,
        service_type: "maintenance",
        title: "Maintain AMRs",
        engineers: [
          { engineer_id: ENGINEER_ID, role: "lead", actor_id: SITE_ID },
        ],
      }).success
    ).toBe(false);
    expect(
      updateFieldServiceOrderSchema.safeParse({ owner_id: ENGINEER_ID }).success
    ).toBe(false);
  });

  it("allows a partial DATE patch while the database validates final ordering", () => {
    expect(
      updateFieldServiceOrderSchema.parse({
        scheduled_end_date: "2026-08-03",
      })
    ).toEqual({ scheduled_end_date: "2026-08-03" });
  });

  it("enforces the NUMERIC(5,1) hour range before the database call", () => {
    expect(
      updateFieldServiceOrderSchema.safeParse({ actual_hours: 10_000 }).success
    ).toBe(false);
    expect(
      updateFieldServiceOrderSchema.safeParse({ estimated_hours: -0.5 })
        .success
    ).toBe(false);
    expect(
      updateFieldServiceOrderSchema.safeParse({ actual_hours: 1.25 }).success
    ).toBe(false);
  });
});
