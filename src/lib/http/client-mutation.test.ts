import { describe, expect, it } from "vitest";
import {
  assertClientMutationResponse,
  clientMutationErrorMessage,
  ExpectedClientMutationError,
} from "./client-mutation";

describe("client mutation response containment", () => {
  it("does not parse a successful empty response", async () => {
    const response = new Response(null, { status: 204 });
    await expect(
      assertClientMutationResponse(response, "Save failed")
    ).resolves.toBeUndefined();
  });

  it("preserves a bounded expected API error", async () => {
    const response = Response.json(
      { error: "Invalid team member update" },
      { status: 400 }
    );

    await expect(
      assertClientMutationResponse(response, "Save failed")
    ).rejects.toEqual(
      new ExpectedClientMutationError("Invalid team member update")
    );
  });

  it.each([
    new Response("not json", { status: 502 }),
    Response.json({ error: { detail: "unexpected shape" } }, { status: 500 }),
    Response.json({ error: "x".repeat(301) }, { status: 500 }),
  ])("falls back for malformed, non-string, or oversized errors", async (response) => {
    await expect(
      assertClientMutationResponse(response, "Safe fallback")
    ).rejects.toEqual(new ExpectedClientMutationError("Safe fallback"));
  });

  it("contains unexpected network/runtime exception text", () => {
    expect(
      clientMutationErrorMessage(
        new Error("socket and provider detail"),
        "Request unavailable"
      )
    ).toBe("Request unavailable");
    expect(
      clientMutationErrorMessage(
        new ExpectedClientMutationError("Validation error"),
        "Request unavailable"
      )
    ).toBe("Validation error");
  });
});
