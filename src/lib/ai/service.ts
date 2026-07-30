import { rateLimit } from "@/lib/rate-limit";
import {
  generateSuggestion,
  type SuggestionResult,
  type SuggestionType,
} from "./suggest";

interface SuggestionServiceDependencies {
  rateLimit: typeof rateLimit;
  generateSuggestion: typeof generateSuggestion;
}

const defaultDependencies: SuggestionServiceDependencies = {
  rateLimit,
  generateSuggestion,
};

export class AiSuggestionRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(resetAt: number) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((resetAt - Date.now()) / 1000)
    );
    super(
      "Rate limit exceeded. Please wait a minute before asking again."
    );
    this.name = "AiSuggestionRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Shared application service for paid AI requests.
 *
 * Callers must authenticate and authorize the actor before invoking this
 * function. Keeping the rate limit and generator invocation here ensures
 * browser and signed Slack entry points enforce the same paid-call guard
 * without one server surface calling another through cookie-bound HTTP.
 */
export async function requestAiSuggestion(
  input: {
    ticketId: string;
    suggestionType: SuggestionType;
    actorId: string;
  },
  dependencies: SuggestionServiceDependencies = defaultDependencies
): Promise<SuggestionResult> {
  const limit = dependencies.rateLimit({
    key: `ai-suggest:${input.actorId}`,
    limit: 20,
    windowMs: 60_000,
  });

  if (!limit.allowed) {
    throw new AiSuggestionRateLimitError(limit.resetAt);
  }

  return dependencies.generateSuggestion(
    input.ticketId,
    input.suggestionType,
    input.actorId
  );
}
