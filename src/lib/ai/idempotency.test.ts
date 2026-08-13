import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSlackAiSuggestionIdempotencyKey,
  cancelAiSuggestionRequest,
  checkpointAiSuggestionProviderAttempt,
  completeAiSuggestionRequest,
  generateAiSuggestionIdempotencyKey,
  normalizeAiSuggestionIdempotencyKey,
  parseAiSuggestionReceipt,
  reserveAiSuggestionRequest,
  type AiSuggestionRequestIdentity,
} from "./idempotency";

const IDENTITY: AiSuggestionRequestIdentity = {
  source: "web",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  ticketId: "22222222-2222-4222-8222-222222222222",
  actorId: "33333333-3333-4333-8333-333333333333",
  suggestionType: "summary",
};

const RECEIPT = {
  id: "44444444-4444-4444-8444-444444444444",
  output_text: "A bounded response",
  confidence_level: "medium",
  suggestion_type: "summary",
  model_name: "test-model",
};

function client(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}

describe("AI suggestion idempotency boundary", () => {
  it("normalizes browser keys and derives stable Slack view keys", () => {
    expect(generateAiSuggestionIdempotencyKey()).toMatch(
      /^[0-9a-f-]{36}$/i
    );
    expect(
      normalizeAiSuggestionIdempotencyKey(
        " 11111111-1111-4111-8111-111111111111 "
      )
    ).toBe("11111111-1111-4111-8111-111111111111");
    expect(normalizeAiSuggestionIdempotencyKey("short")).toBeNull();
    expect(buildSlackAiSuggestionIdempotencyKey("V1234567890")).toBe(
      "slack:ai-view:V1234567890"
    );
  });

  it("returns a reserved request and sends only the authoritative identity", async () => {
    const mock = client({ state: "reserved" });

    await expect(
      reserveAiSuggestionRequest({ supabase: mock.client, identity: IDENTITY })
    ).resolves.toEqual({ state: "reserved" });
    expect(mock.rpc).toHaveBeenCalledWith("reserve_ai_suggestion_request", {
      p_source: "web",
      p_idempotency_key: IDENTITY.idempotencyKey,
      p_ticket_id: IDENTITY.ticketId,
      p_actor_id: IDENTITY.actorId,
      p_suggestion_type: "summary",
    });
  });

  it.each([
    ["in_progress", false],
    ["provider_attempted", true],
  ])("maps %s reservations without fabricating a result", async (state, providerAttempted) => {
    const mock = client({ state });

    await expect(
      reserveAiSuggestionRequest({ supabase: mock.client, identity: IDENTITY })
    ).resolves.toEqual({ state: "in_progress", providerAttempted });
  });

  it("hydrates an exact completed receipt and restores mock state", async () => {
    const mock = client({
      state: "completed",
      ...RECEIPT,
      model_name: "mock:provider_error",
    });

    await expect(
      reserveAiSuggestionRequest({ supabase: mock.client, identity: IDENTITY })
    ).resolves.toEqual({
      state: "completed",
      result: {
        ...RECEIPT,
        model_name: "mock:provider_error",
        _mock: true,
        _mock_reason: "provider_error",
      },
    });
  });

  it("rejects malformed database receipts", async () => {
    expect(() => parseAiSuggestionReceipt({ ...RECEIPT, id: "bad" })).toThrow(
      "Invalid AI suggestion receipt"
    );
    const mock = client({ state: "unexpected" });
    await expect(
      reserveAiSuggestionRequest({ supabase: mock.client, identity: IDENTITY })
    ).rejects.toThrow("Invalid AI suggestion reservation receipt");
  });

  it("cancels only when the command returns an exact boolean", async () => {
    const accepted = client(true);
    await expect(
      cancelAiSuggestionRequest({
        supabase: accepted.client,
        identity: IDENTITY,
      })
    ).resolves.toBe(true);

    const malformed = client("true");
    await expect(
      cancelAiSuggestionRequest({
        supabase: malformed.client,
        identity: IDENTITY,
      })
    ).rejects.toThrow("Invalid AI suggestion cancellation receipt");
  });

  it("requires a server timestamp from the provider checkpoint", async () => {
    const accepted = client("2026-08-11T12:00:00.000Z");
    await expect(
      checkpointAiSuggestionProviderAttempt({
        supabase: accepted.client,
        identity: IDENTITY,
      })
    ).resolves.toBe("2026-08-11T12:00:00.000Z");

    const rejected = client(null);
    await expect(
      checkpointAiSuggestionProviderAttempt({
        supabase: rejected.client,
        identity: IDENTITY,
      })
    ).rejects.toThrow("provider checkpoint was not accepted");
  });

  it("completes through the atomic command and returns its durable receipt", async () => {
    const mock = client(RECEIPT);

    await expect(
      completeAiSuggestionRequest({
        supabase: mock.client,
        identity: IDENTITY,
        result: { ...RECEIPT, id: null },
      })
    ).resolves.toEqual(RECEIPT);
    expect(mock.rpc).toHaveBeenCalledWith(
      "complete_ai_suggestion_request_atomic",
      {
        p_input: {
          source: "web",
          idempotency_key: IDENTITY.idempotencyKey,
          ticket_id: IDENTITY.ticketId,
          actor_id: IDENTITY.actorId,
          suggestion_type: "summary",
          model_name: "test-model",
          prompt_version: "v1",
          output_text: "A bounded response",
          confidence_level: "medium",
        },
      }
    );
  });

  it("propagates command errors without leaking a fabricated receipt", async () => {
    const mock = client(null, { code: "XX000", message: "private" });
    await expect(
      reserveAiSuggestionRequest({ supabase: mock.client, identity: IDENTITY })
    ).rejects.toMatchObject({ code: "XX000" });
  });
});
