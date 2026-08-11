import { rateLimit } from "@/lib/rate-limit";
import {
  buildRateLimitBucketKey,
  consumeDistributedRateLimit,
  type DistributedRateLimitResult,
} from "@/lib/distributed-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AiSuggestionInProgressError,
  AiSuggestionOutcomeUnknownError,
  AiSuggestionRateLimitError,
  AiSuggestionUnavailableError,
} from "./errors";
import {
  generateSuggestion,
  type SuggestionResult,
  type SuggestionType,
} from "./suggest";
import {
  cancelAiSuggestionRequest,
  checkpointAiSuggestionProviderAttempt,
  completeAiSuggestionRequest,
  reserveAiSuggestionRequest,
  type AiSuggestionRequestIdentity,
  type AiSuggestionRequestSource,
  type AiSuggestionReservation,
} from "./idempotency";

export {
  AiSuggestionInProgressError,
  AiSuggestionOutcomeUnknownError,
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

export interface SuggestionServiceDependencies {
  rateLimit: typeof rateLimit;
  consumeDistributedRateLimit: ConsumeAiSuggestionLimit;
  generateSuggestion: typeof generateSuggestion;
  reserveRequest: (
    identity: AiSuggestionRequestIdentity
  ) => Promise<AiSuggestionReservation>;
  cancelRequest: (identity: AiSuggestionRequestIdentity) => Promise<boolean>;
  checkpointProviderAttempt: (
    identity: AiSuggestionRequestIdentity
  ) => Promise<string>;
  completeRequest: (args: {
    identity: AiSuggestionRequestIdentity;
    result: SuggestionResult;
  }) => Promise<SuggestionResult>;
}

const defaultDependencies: SuggestionServiceDependencies = {
  rateLimit,
  consumeDistributedRateLimit: (args) =>
    consumeDistributedRateLimit({
      supabase: createAdminClient(),
      ...args,
    }),
  generateSuggestion,
  reserveRequest: (identity) =>
    reserveAiSuggestionRequest({
      supabase: createAdminClient(),
      identity,
    }),
  cancelRequest: (identity) =>
    cancelAiSuggestionRequest({
      supabase: createAdminClient(),
      identity,
    }),
  checkpointProviderAttempt: (identity) =>
    checkpointAiSuggestionProviderAttempt({
      supabase: createAdminClient(),
      identity,
    }),
  completeRequest: ({ identity, result }) =>
    completeAiSuggestionRequest({
      supabase: createAdminClient(),
      identity,
      result,
    }),
};

async function releaseUnusedReservation(
  dependencies: SuggestionServiceDependencies,
  identity: AiSuggestionRequestIdentity
): Promise<boolean> {
  try {
    return await dependencies.cancelRequest(identity);
  } catch {
    return false;
  }
}

/**
 * Shared application service for paid AI requests.
 *
 * Callers must authenticate and authorize the actor before invoking this
 * function. Keeping the durable request reservation, actor quota, provider
 * checkpoint, and atomic completion here ensures browser and signed Slack
 * entry points enforce the same paid-call boundary without one server surface
 * calling another through cookie-bound HTTP.
 */
export async function requestAiSuggestion(
  input: {
    ticketId: string;
    suggestionType: SuggestionType;
    actorId: string;
    source: AiSuggestionRequestSource;
    idempotencyKey: string;
  },
  dependencies: SuggestionServiceDependencies = defaultDependencies
): Promise<SuggestionResult> {
  const identity: AiSuggestionRequestIdentity = {
    source: input.source,
    idempotencyKey: input.idempotencyKey,
    ticketId: input.ticketId,
    actorId: input.actorId,
    suggestionType: input.suggestionType,
  };

  let reservation: AiSuggestionReservation;
  try {
    reservation = await dependencies.reserveRequest(identity);
  } catch {
    throw new AiSuggestionUnavailableError();
  }

  if (reservation.state === "completed") return reservation.result;
  if (reservation.state === "in_progress") {
    throw new AiSuggestionInProgressError(reservation.providerAttempted);
  }

  const limit = dependencies.rateLimit({
    key: `ai-suggest:${input.actorId}`,
    limit: AI_SUGGESTION_LIMIT,
    windowMs: AI_SUGGESTION_WINDOW_MS,
  });

  if (!limit.allowed) {
    await releaseUnusedReservation(dependencies, identity);
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
    await releaseUnusedReservation(dependencies, identity);
    throw new AiSuggestionUnavailableError();
  }

  if (!distributedLimit.allowed) {
    await releaseUnusedReservation(dependencies, identity);
    throw new AiSuggestionRateLimitError(distributedLimit.resetAt);
  }

  let providerAttempted = false;
  let generated: SuggestionResult;
  try {
    generated = await dependencies.generateSuggestion(
      input.ticketId,
      input.suggestionType,
      {
        beforeProviderAttempt: async () => {
          await dependencies.checkpointProviderAttempt(identity);
          providerAttempted = true;
        },
      }
    );
  } catch (error) {
    if (!providerAttempted) {
      await releaseUnusedReservation(dependencies, identity);
      throw error;
    }
    throw new AiSuggestionOutcomeUnknownError();
  }

  try {
    return await dependencies.completeRequest({ identity, result: generated });
  } catch {
    if (!providerAttempted) {
      await releaseUnusedReservation(dependencies, identity);
      throw new AiSuggestionUnavailableError();
    }
    throw new AiSuggestionOutcomeUnknownError();
  }
}
