import { describe, expect, it, vi } from "vitest";
import type { rateLimit } from "@/lib/rate-limit";
import { buildRateLimitBucketKey } from "@/lib/distributed-rate-limit";
import {
  AiSuggestionInProgressError,
  AiSuggestionOutcomeUnknownError,
  AiSuggestionRateLimitError,
  AiSuggestionUnavailableError,
  requestAiSuggestion,
  type SuggestionServiceDependencies,
} from "./service";

const TICKET_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_KEY = "33333333-3333-4333-8333-333333333333";
const SUGGESTION_ID = "44444444-4444-4444-8444-444444444444";

const INPUT = {
  ticketId: TICKET_ID,
  suggestionType: "troubleshooting" as const,
  actorId: ACTOR_ID,
  source: "web" as const,
  idempotencyKey: REQUEST_KEY,
};

const GENERATED = {
  id: null,
  output_text: "Check the controller logs.",
  confidence_level: "medium" as const,
  suggestion_type: "troubleshooting" as const,
  model_name: "test-model",
};

const COMPLETED = { ...GENERATED, id: SUGGESTION_ID };

function dependencies(
  override: Partial<SuggestionServiceDependencies> = {}
): SuggestionServiceDependencies {
  return {
    rateLimit: vi.fn().mockReturnValue({
      allowed: true,
      remaining: 19,
      resetAt: Date.now() + 60_000,
    }) as typeof rateLimit,
    consumeDistributedRateLimit: vi.fn().mockResolvedValue({
      allowed: true,
      remaining: 19,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    reserveRequest: vi.fn().mockResolvedValue({ state: "reserved" }),
    cancelRequest: vi.fn().mockResolvedValue(true),
    checkpointProviderAttempt: vi
      .fn()
      .mockResolvedValue("2026-08-11T12:00:00.000Z"),
    generateSuggestion: vi.fn().mockImplementation(
      async (
        _ticketId: string,
        _suggestionType: string,
        options: { beforeProviderAttempt?: () => Promise<void> }
      ) => {
        await options.beforeProviderAttempt?.();
        return GENERATED;
      }
    ),
    completeRequest: vi.fn().mockResolvedValue(COMPLETED),
    ...override,
  } as SuggestionServiceDependencies;
}

describe("AI suggestion application service", () => {
  it("reserves, rate-limits, checkpoints, invokes, and completes one paid request", async () => {
    const deps = dependencies();

    await expect(requestAiSuggestion(INPUT, deps)).resolves.toEqual(COMPLETED);

    const identity = {
      source: "web",
      idempotencyKey: REQUEST_KEY,
      ticketId: TICKET_ID,
      actorId: ACTOR_ID,
      suggestionType: "troubleshooting",
    };
    expect(deps.reserveRequest).toHaveBeenCalledWith(identity);
    expect(deps.rateLimit).toHaveBeenCalledWith({
      key: `ai-suggest:${ACTOR_ID}`,
      limit: 20,
      windowMs: 60_000,
    });
    expect(deps.consumeDistributedRateLimit).toHaveBeenCalledWith({
      bucketKey: buildRateLimitBucketKey("ai-suggestion", ACTOR_ID),
      limit: 20,
      windowSeconds: 60,
    });
    expect(deps.checkpointProviderAttempt).toHaveBeenCalledWith(identity);
    expect(deps.generateSuggestion).toHaveBeenCalledWith(
      TICKET_ID,
      "troubleshooting",
      expect.objectContaining({
        beforeProviderAttempt: expect.any(Function),
      })
    );
    expect(deps.completeRequest).toHaveBeenCalledWith({
      identity,
      result: GENERATED,
    });
    expect(deps.cancelRequest).not.toHaveBeenCalled();
    expect(
      vi.mocked(deps.checkpointProviderAttempt).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(deps.completeRequest).mock.invocationCallOrder[0]
    );
  });

  it("returns the first completed receipt without consuming quota or calling the provider", async () => {
    const deps = dependencies({
      reserveRequest: vi.fn().mockResolvedValue({
        state: "completed",
        result: COMPLETED,
      }),
    });

    await expect(requestAiSuggestion(INPUT, deps)).resolves.toEqual(COMPLETED);

    expect(deps.rateLimit).not.toHaveBeenCalled();
    expect(deps.consumeDistributedRateLimit).not.toHaveBeenCalled();
    expect(deps.generateSuggestion).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "fails closed for an existing request (provider attempted: %s)",
    async (providerAttempted) => {
      const deps = dependencies({
        reserveRequest: vi.fn().mockResolvedValue({
          state: "in_progress",
          providerAttempted,
        }),
      });

      await expect(requestAiSuggestion(INPUT, deps)).rejects.toMatchObject({
        name: "AiSuggestionInProgressError",
        providerAttempted,
      });
      expect(deps.rateLimit).not.toHaveBeenCalled();
      expect(deps.generateSuggestion).not.toHaveBeenCalled();
    }
  );

  it("cancels a pre-provider reservation when the fast quota is exhausted", async () => {
    const deps = dependencies({
      rateLimit: vi.fn().mockReturnValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30_000,
      }) as typeof rateLimit,
    });

    await expect(requestAiSuggestion(INPUT, deps)).rejects.toBeInstanceOf(
      AiSuggestionRateLimitError
    );

    expect(deps.cancelRequest).toHaveBeenCalledTimes(1);
    expect(deps.consumeDistributedRateLimit).not.toHaveBeenCalled();
    expect(deps.generateSuggestion).not.toHaveBeenCalled();
  });

  it("cancels a pre-provider reservation when the durable quota is exhausted", async () => {
    const resetAt = new Date(Date.now() + 30_000).toISOString();
    const deps = dependencies({
      consumeDistributedRateLimit: vi.fn().mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt,
      }),
    });

    await expect(requestAiSuggestion(INPUT, deps)).rejects.toBeInstanceOf(
      AiSuggestionRateLimitError
    );

    expect(deps.cancelRequest).toHaveBeenCalledTimes(1);
    expect(deps.generateSuggestion).not.toHaveBeenCalled();
  });

  it("cancels before provider I/O when durable enforcement is unavailable", async () => {
    const deps = dependencies({
      consumeDistributedRateLimit: vi
        .fn()
        .mockRejectedValue(new Error("private database detail")),
    });

    await expect(requestAiSuggestion(INPUT, deps)).rejects.toBeInstanceOf(
      AiSuggestionUnavailableError
    );

    expect(deps.cancelRequest).toHaveBeenCalledTimes(1);
    expect(deps.generateSuggestion).not.toHaveBeenCalled();
  });

  it("releases a safe reservation when context loading fails before the checkpoint", async () => {
    const unavailable = new AiSuggestionUnavailableError();
    const deps = dependencies({
      generateSuggestion: vi.fn().mockRejectedValue(unavailable),
    });

    await expect(requestAiSuggestion(INPUT, deps)).rejects.toBe(unavailable);
    expect(deps.cancelRequest).toHaveBeenCalledTimes(1);
    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it("fails closed when execution breaks after the provider checkpoint", async () => {
    const deps = dependencies({
      generateSuggestion: vi.fn().mockImplementation(
        async (
          _ticketId: string,
          _suggestionType: string,
          options: { beforeProviderAttempt?: () => Promise<void> }
        ) => {
          await options.beforeProviderAttempt?.();
          throw new Error("transport outcome unknown");
        }
      ),
    });

    await expect(requestAiSuggestion(INPUT, deps)).rejects.toBeInstanceOf(
      AiSuggestionOutcomeUnknownError
    );
    expect(deps.cancelRequest).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it("fails closed when the durable receipt is unavailable after provider I/O", async () => {
    const deps = dependencies({
      completeRequest: vi
        .fn()
        .mockRejectedValue(new Error("database acknowledgement lost")),
    });

    await expect(requestAiSuggestion(INPUT, deps)).rejects.toBeInstanceOf(
      AiSuggestionOutcomeUnknownError
    );
    expect(deps.cancelRequest).not.toHaveBeenCalled();
  });

  it("releases a mock-only request when completion fails before provider I/O", async () => {
    const deps = dependencies({
      generateSuggestion: vi.fn().mockResolvedValue({
        ...GENERATED,
        model_name: "mock:no_api_key",
        _mock: true,
        _mock_reason: "no_api_key",
      }),
      completeRequest: vi
        .fn()
        .mockRejectedValue(new Error("database unavailable")),
    });

    await expect(requestAiSuggestion(INPUT, deps)).rejects.toBeInstanceOf(
      AiSuggestionUnavailableError
    );
    expect(deps.checkpointProviderAttempt).not.toHaveBeenCalled();
    expect(deps.cancelRequest).toHaveBeenCalledTimes(1);
  });

  it("hides reservation database failures behind service unavailability", async () => {
    const deps = dependencies({
      reserveRequest: vi
        .fn()
        .mockRejectedValue(new Error("private database detail")),
    });

    await expect(requestAiSuggestion(INPUT, deps)).rejects.toBeInstanceOf(
      AiSuggestionUnavailableError
    );
    expect(deps.rateLimit).not.toHaveBeenCalled();
  });

  it("uses the dedicated in-progress error type", () => {
    expect(new AiSuggestionInProgressError(true)).toMatchObject({
      name: "AiSuggestionInProgressError",
      providerAttempted: true,
    });
  });
});
