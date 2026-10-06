import { describe, expect, it } from "vitest";
import {
  assertClientMutationResponse,
  clientMutationErrorMessage,
  ExpectedClientMutationError,
  readClientJsonResponse,
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
      new ExpectedClientMutationError("Invalid team member update", undefined, 400)
    );
  });

  it.each([
    new Response("not json", { status: 502 }),
    Response.json({ error: { detail: "unexpected shape" } }, { status: 500 }),
    Response.json({ error: "x".repeat(301) }, { status: 500 }),
  ])("falls back for malformed, non-string, or oversized errors", async (response) => {
    await expect(
      assertClientMutationResponse(response, "Safe fallback")
    ).rejects.toMatchObject({
      name: "ExpectedClientMutationError",
      message: "Safe fallback",
      code: undefined,
      status: response.status,
    });
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

  it("reads a successful JSON response after checking status", async () => {
    await expect(
      readClientJsonResponse(Response.json({ ok: true }), "Read failed")
    ).resolves.toEqual({ ok: true });
  });

  it("uses the safe fallback for malformed successful JSON", async () => {
    await expect(
      readClientJsonResponse(
        new Response("not json", { status: 200 }),
        "Response unavailable"
      )
    ).rejects.toEqual(
      new ExpectedClientMutationError("Response unavailable")
    );
  });
});

describe("client mutation error codes", () => {
  it("carries a well-formed API code and status for translated copy", async () => {
    const { clientMutationErrorCode, clientMutationErrorStatus } = await import(
      "./client-mutation"
    );
    const error = await assertClientMutationResponse(
      Response.json({ error: "Exists", code: "USER_EMAIL_EXISTS" }, { status: 409 }),
      "Failed"
    ).catch((caught: unknown) => caught);
    expect(clientMutationErrorCode(error)).toBe("USER_EMAIL_EXISTS");
    expect(clientMutationErrorStatus(error)).toBe(409);

    const malformed = await assertClientMutationResponse(
      Response.json({ error: "x", code: "<script>" }, { status: 400 }),
      "Failed"
    ).catch((caught: unknown) => caught);
    expect(clientMutationErrorCode(malformed)).toBeUndefined();
    expect(clientMutationErrorCode(new Error("network"))).toBeUndefined();
  });
});
