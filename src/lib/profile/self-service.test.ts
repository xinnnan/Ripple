import { describe, expect, it } from "vitest";
import {
  normalizeSelfServiceProfile,
  PASSWORD_UPDATE_ERROR_MESSAGE,
  PROFILE_UPDATE_ERROR_MESSAGE,
} from "./self-service";

describe("self-service profile contract", () => {
  it("trims profile fields and normalizes an empty phone to null", () => {
    expect(
      normalizeSelfServiceProfile({
        fullName: "  Alex Rivera  ",
        phone: "   ",
      })
    ).toEqual({
      success: true,
      data: { fullName: "Alex Rivera", phone: null },
    });
  });

  it("preserves a bounded phone value", () => {
    expect(
      normalizeSelfServiceProfile({
        fullName: "Alex Rivera",
        phone: " +1 555 0100 ",
      })
    ).toEqual({
      success: true,
      data: { fullName: "Alex Rivera", phone: "+1 555 0100" },
    });
  });

  it("rejects an empty name", () => {
    expect(
      normalizeSelfServiceProfile({ fullName: "   ", phone: "" })
    ).toEqual({ success: false, error: "Full name is required." });
  });

  it("rejects overlong profile fields", () => {
    expect(
      normalizeSelfServiceProfile({ fullName: "x".repeat(201), phone: "" })
    ).toMatchObject({ success: false });
    expect(
      normalizeSelfServiceProfile({
        fullName: "Alex",
        phone: "1".repeat(51),
      })
    ).toMatchObject({ success: false });
  });

  it("uses generic mutation messages that contain no provider detail", () => {
    expect(PROFILE_UPDATE_ERROR_MESSAGE).toBe(
      "Unable to update your profile. Please try again."
    );
    expect(PASSWORD_UPDATE_ERROR_MESSAGE).toBe(
      "Unable to update your password. Please try again."
    );
  });
});
