const MAX_CLIENT_ERROR_LENGTH = 300;

export class ExpectedClientMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpectedClientMutationError";
  }
}

function boundedErrorMessage(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const message = value.trim();
  return message.length > 0 && message.length <= MAX_CLIENT_ERROR_LENGTH
    ? message
    : fallback;
}

/** Parse only failed responses; successful endpoints may legitimately be 204. */
export async function assertClientMutationResponse(
  response: Response,
  fallback: string
): Promise<void> {
  if (response.ok) return;

  const body = (await response.json().catch(() => null)) as unknown;
  const error =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error?: unknown }).error
      : undefined;
  throw new ExpectedClientMutationError(
    boundedErrorMessage(error, fallback)
  );
}

/** Expose allow-listed API errors; contain network/runtime exception details. */
export function clientMutationErrorMessage(
  error: unknown,
  fallback: string
): string {
  return error instanceof ExpectedClientMutationError
    ? error.message
    : fallback;
}
