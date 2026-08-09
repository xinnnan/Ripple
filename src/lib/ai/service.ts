import { rateLimit } from "@/lib/rate-limit";
import {
  buildRateLimitBucketKey,
  consumeDistributedRateLimit,
  type DistributedRateLimitResult,
} from "@/lib/distributed-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AiSuggestionRateLimitError,
  AiSuggestionUnavailableError,
} from "./errors";
import {
  generateSuggestion,
  type SuggestionResult,
  type SuggestionType,
} from "./suggest";

export {
  AiSuggestionRateLimitError,
  AiSuggestionTicketNotFoundError,
  AiSuggestionUnavailableError,
} from "./errors";

const AI_SUGGESTION_LIMIT = 20;
const AI_SUGGESTION_WINDOW_MS = 60_000;
const AI_SUGGESTION_WINDOW_SECONDS = 60;

type ConsumeAiSuggestionLimit = (args: {
  bucketKey: string;
  limit: number;
  windowSeconds: number;
}) => Promise<DistributedRateLimitResult>;

interface SuggestionServiceDependencies {
  rateLimit: typeof rateLimit;
  consumeDistributedRateLimit: ConsumeAiSuggestionLimit;
  generateSuggestion: typeof generateSuggestion;
}

const defaultDependencies: SuggestionServiceDependencies = {
  rateLimit,
  consumeDistributedRateLimit: (args) =>
    consumeDistributedRateLimit({
      supabase: createAdminClient(),
      ...args,
    }),
  generateSuggestion,
};

/**
 * Shared application service for paid AI requests.
 *
 * Callers must authenticate and authorize the actor before invoking this
 * function. Keeping the fast local guard, durable actor quota, and generator
 * invocation here ensures browser and signed Slack entry points enforce the
 * same paid-call boundary without one server surface calling another through
 * cookie-bound HTTP.
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
    limit: AI_SUGGESTION_LIMIT,
    windowMs: AI_SUGGESTION_WINDOW_MS,
  });

  if (!limit.allowed) {
    throw new AiSuggestionRateLimitError(limit.resetAt);
  }

  let distributedLimit: DistributedRateLimitResult;
  try {
    distributedLimit = await dependencies.consumeDistributedRateLimit({
      bucketKey: buildRateLimitBucketKey("ai-suggestion", input.actorId),
      limit: AI_SUGGESTION_LIMIT,
      windowSeconds: AI_SUGGESTION_WINDOW_SECONDS,
    });
  } catch {
    throw new AiSuggestionUnavailableError();
  }

  if (!distributedLimit.allowed) {
    throw new AiSuggestionRateLimitError(distributedLimit.resetAt);
  }

  return dependencies.generateSuggestion(
    input.ticketId,
    input.suggestionType,
    input.actorId
  );
}
