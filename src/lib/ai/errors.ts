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
