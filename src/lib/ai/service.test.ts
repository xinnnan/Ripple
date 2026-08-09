import { describe, expect, it, vi } from "vitest";
import type { rateLimit } from "@/lib/rate-limit";
import { buildRateLimitBucketKey } from "@/lib/distributed-rate-limit";
import type { generateSuggestion } from "./suggest";
import {
  AiSuggestionRateLimitError,
  AiSuggestionUnavailableError,
  requestAiSuggestion,
} from "./service";

const TICKET_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

describe("AI suggestion application service", () => {
  it("applies the paid-call guard and invokes the domain generator", async () => {
    const checkLimit = vi.fn().mockReturnValue({
      allowed: true,
      remaining: 19,
      resetAt: Date.now() + 60_000,
    });
    const generate = vi.fn().mockResolvedValue({
      id: null,
      output_text: "Check the controller logs.",
      confidence_level: "medium",
      suggestion_type: "troubleshooting",
      model_name: "test-model",
    });
    const consumeDistributedLimit = vi.fn().mockResolvedValue({
      allowed: true,
      remaining: 19,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(
      requestAiSuggestion(
        {
          ticketId: TICKET_ID,
          suggestionType: "troubleshooting",
          actorId: ACTOR_ID,
        },
        {
          rateLimit: checkLimit as typeof rateLimit,
          consumeDistributedRateLimit: consumeDistributedLimit,
          generateSuggestion: generate as typeof generateSuggestion,
        }
      )
    ).resolves.toMatchObject({
      output_text: "Check the controller logs.",
      suggestion_type: "troubleshooting",
    });

    expect(checkLimit).toHaveBeenCalledWith({
      key: `ai-suggest:${ACTOR_ID}`,
      limit: 20,
      windowMs: 60_000,
    });
    expect(consumeDistributedLimit).toHaveBeenCalledWith({
      bucketKey: buildRateLimitBucketKey("ai-suggestion", ACTOR_ID),
      limit: 20,
      windowSeconds: 60,
    });
    expect(generate).toHaveBeenCalledWith(
      TICKET_ID,
      "troubleshooting",
      ACTOR_ID
    );
  });

  it("rejects over-limit requests before invoking the provider", async () => {
    const generate = vi.fn();
    const consumeDistributedLimit = vi.fn();

    await expect(
      requestAiSuggestion(
        {
          ticketId: TICKET_ID,
          suggestionType: "summary",
          actorId: ACTOR_ID,
        },
        {
          rateLimit: vi.fn().mockReturnValue({
            allowed: false,
            remaining: 0,
            resetAt: Date.now() + 30_000,
          }) as typeof rateLimit,
          consumeDistributedRateLimit: consumeDistributedLimit,
          generateSuggestion: generate as typeof generateSuggestion,
        }
      )
    ).rejects.toBeInstanceOf(AiSuggestionRateLimitError);

    expect(consumeDistributedLimit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("enforces the durable per-actor limit across application instances", async () => {
    const generate = vi.fn();
    const resetAt = new Date(Date.now() + 30_000).toISOString();

    await expect(
      requestAiSuggestion(
        {
          ticketId: TICKET_ID,
          suggestionType: "summary",
          actorId: ACTOR_ID,
        },
        {
          rateLimit: vi.fn().mockReturnValue({
            allowed: true,
            remaining: 19,
            resetAt: Date.now() + 60_000,
          }) as typeof rateLimit,
          consumeDistributedRateLimit: vi.fn().mockResolvedValue({
            allowed: false,
            remaining: 0,
            resetAt,
          }),
          generateSuggestion: generate as typeof generateSuggestion,
        }
      )
    ).rejects.toBeInstanceOf(AiSuggestionRateLimitError);

    expect(generate).not.toHaveBeenCalled();
  });

  it("fails closed before provider I/O when durable enforcement is unavailable", async () => {
    const generate = vi.fn();

    await expect(
      requestAiSuggestion(
        {
          ticketId: TICKET_ID,
          suggestionType: "summary",
          actorId: ACTOR_ID,
        },
        {
          rateLimit: vi.fn().mockReturnValue({
            allowed: true,
            remaining: 19,
            resetAt: Date.now() + 60_000,
          }) as typeof rateLimit,
          consumeDistributedRateLimit: vi
            .fn()
            .mockRejectedValue(new Error("private database detail")),
          generateSuggestion: generate as typeof generateSuggestion,
        }
      )
    ).rejects.toBeInstanceOf(AiSuggestionUnavailableError);

    expect(generate).not.toHaveBeenCalled();
  });
});
