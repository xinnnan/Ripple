export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;

export function normalizeIdempotencyKey(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    normalized.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    normalized.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !IDEMPOTENCY_KEY_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}
