const MAX_CLIENT_ERROR_LENGTH = 300;

export class ExpectedClientMutationError extends Error {
  constructor(
    message: string,
    /** Stable machine code from the API, used to show translated copy. */
    readonly code?: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ExpectedClientMutationError";
  }
}

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

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
  const record =
    typeof body === "object" && body !== null
      ? (body as { error?: unknown; code?: unknown })
      : {};
  throw new ExpectedClientMutationError(
    boundedErrorMessage(record.error, fallback),
    typeof record.code === "string" && ERROR_CODE_PATTERN.test(record.code)
      ? record.code
      : undefined,
    response.status
  );
}

/** Read JSON after applying the same bounded non-2xx error contract. */
export async function readClientJsonResponse(
  response: Response,
  fallback: string
): Promise<unknown> {
  await assertClientMutationResponse(response, fallback);
  try {
    return await response.json();
  } catch {
    throw new ExpectedClientMutationError(fallback);
  }
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

/** The API's stable error code, when the failure carried one. */
export function clientMutationErrorCode(error: unknown): string | undefined {
  return error instanceof ExpectedClientMutationError ? error.code : undefined;
}

/** HTTP status of an expected API failure, when known. */
export function clientMutationErrorStatus(error: unknown): number | undefined {
  return error instanceof ExpectedClientMutationError ? error.status : undefined;
}

/**
 * API error messages are written in English. English readers get the precise
 * bounded message; every other language gets the translated fallback.
 */
export function localizedClientMutationError(
  error: unknown,
  fallback: string,
  locale: string
): string {
  return locale === "en" ? clientMutationErrorMessage(error, fallback) : fallback;
}
