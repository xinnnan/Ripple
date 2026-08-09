export const TICKET_IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const TICKET_IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const TICKET_IDEMPOTENCY_KEY_MAX_LENGTH = 200;

const TICKET_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;

export function normalizeTicketIdempotencyKey(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    normalized.length < TICKET_IDEMPOTENCY_KEY_MIN_LENGTH ||
    normalized.length > TICKET_IDEMPOTENCY_KEY_MAX_LENGTH ||
    !TICKET_IDEMPOTENCY_KEY_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function generateTicketIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function buildSlackTicketIdempotencyKey(viewId: string): string {
  const key = normalizeTicketIdempotencyKey(`slack:view:${viewId}`);
  if (!key) throw new Error("Invalid Slack view identifier");
  return key;
}

export function buildSlackTicketCommentIdempotencyKey(
  viewId: string
): string {
  const key = normalizeTicketIdempotencyKey(`slack:comment-view:${viewId}`);
  if (!key) throw new Error("Invalid Slack comment view identifier");
  return key;
}
