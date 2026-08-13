export class AiSuggestionRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(resetAt: number | string) {
    const resetAtMs =
      typeof resetAt === "number" ? resetAt : Date.parse(resetAt);
    const retryAfterSeconds = Number.isFinite(resetAtMs)
      ? Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000))
      : 60;

    super(
      "Rate limit exceeded. Please wait a minute before asking again."
    );
    this.name = "AiSuggestionRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AiSuggestionUnavailableError extends Error {
  constructor() {
    super("Ripple Assist is temporarily unavailable. Please retry.");
    this.name = "AiSuggestionUnavailableError";
  }
}

export class AiSuggestionTicketNotFoundError extends Error {
  constructor() {
    super("Ticket is not available for Ripple Assist.");
    this.name = "AiSuggestionTicketNotFoundError";
  }
}

export class AiSuggestionInProgressError extends Error {
  readonly providerAttempted: boolean;

  constructor(providerAttempted: boolean) {
    super(
      providerAttempted
        ? "This Ripple Assist request crossed the provider boundary and its result is still being reconciled. Retry with the same request key; do not submit a duplicate automatically."
        : "This Ripple Assist request is already in progress. Retry with the same request key shortly."
    );
    this.name = "AiSuggestionInProgressError";
    this.providerAttempted = providerAttempted;
  }
}

export class AiSuggestionOutcomeUnknownError extends Error {
  constructor() {
    super(
      "Ripple Assist may have completed the provider request, but its durable receipt is not yet available. Retry with the same request key; do not submit a duplicate automatically."
    );
    this.name = "AiSuggestionOutcomeUnknownError";
  }
}
