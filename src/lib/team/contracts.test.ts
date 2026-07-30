import { describe, expect, it } from "vitest";
import { updateTeamMemberSchema } from "./contracts";

const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "22222222-2222-4222-8222-222222222222";

describe("team member update contract", () => {
  it("accepts profile fields and an explicit desired site set", () => {
    expect(
      updateTeamMemberSchema.parse({
        full_name: "  Alex Rivera  ",
        status: "inactive",
        site_ids: [SITE_A, SITE_B],
      })
    ).toEqual({
      full_name: "Alex Rivera",
      status: "inactive",
      site_ids: [SITE_A, SITE_B],
    });
  });

  it("distinguishes an omitted site set from an explicit clear", () => {
    expect(updateTeamMemberSchema.parse({ status: "active" })).toEqual({
      status: "active",
    });
    expect(updateTeamMemberSchema.parse({ site_ids: [] })).toEqual({
      site_ids: [],
    });
  });

  it("rejects duplicate and malformed site ids", () => {
    expect(
      updateTeamMemberSchema.safeParse({ site_ids: [SITE_A, SITE_A] }).success
    ).toBe(false);
    expect(
      updateTeamMemberSchema.safeParse({ site_ids: ["not-a-uuid"] }).success
    ).toBe(false);
  });

  it("rejects empty names, unsupported statuses, and oversized site sets", () => {
    expect(
      updateTeamMemberSchema.safeParse({ full_name: "   " }).success
    ).toBe(false);
    expect(
      updateTeamMemberSchema.safeParse({ status: "suspended" }).success
    ).toBe(false);
    expect(
      updateTeamMemberSchema.safeParse({
        site_ids: Array.from(
          { length: 101 },
          (_, index) =>
            `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
        ),
      }).success
    ).toBe(false);
  });
});
