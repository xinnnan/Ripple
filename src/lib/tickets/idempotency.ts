import {
  generateIdempotencyKey,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  normalizeIdempotencyKey,
} from "@/lib/idempotency";

export const TICKET_IDEMPOTENCY_KEY_HEADER = IDEMPOTENCY_KEY_HEADER;
export const TICKET_IDEMPOTENCY_KEY_MIN_LENGTH = IDEMPOTENCY_KEY_MIN_LENGTH;
export const TICKET_IDEMPOTENCY_KEY_MAX_LENGTH = IDEMPOTENCY_KEY_MAX_LENGTH;

export function normalizeTicketIdempotencyKey(
  value: string | null | undefined
): string | null {
  return normalizeIdempotencyKey(value);
}

export function generateTicketIdempotencyKey(): string {
  return generateIdempotencyKey();
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
