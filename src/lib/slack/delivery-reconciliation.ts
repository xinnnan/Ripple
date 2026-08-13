import type { WebClient } from "@slack/web-api";

const RECONCILIATION_WINDOW_MS = 10 * 60 * 1000;
const RECONCILIATION_PAGE_LIMIT = 15;
const DELIVERY_EVENT_TYPE = "ripple_ticket_delivery";
const METADATA_READ_SCOPE = "metadata.message:read";
const SCOPE_CHECK_TIMEOUT_MS = 5_000;

interface SlackDeliveryMessage {
  ts?: unknown;
  metadata?: {
    event_type?: unknown;
    event_payload?: unknown;
  };
}

interface SlackDeliveryPage {
  messages?: unknown;
  has_more?: unknown;
  response_metadata?: {
    next_cursor?: unknown;
  };
}

export type SlackDeliveryReconciliationResult =
  | { ok: true; messageTs: string | null }
  | { ok: false; errorCode: string };

export function boundedSlackProviderCode(error: unknown): string {
  if (!error || typeof error !== "object") return "reconciliation_failed";

  const candidate = error as {
    code?: unknown;
    data?: { error?: unknown };
  };
  const value =
    typeof candidate.data?.error === "string"
      ? candidate.data.error
      : typeof candidate.code === "string"
        ? candidate.code
        : "reconciliation_failed";

  return /^[A-Za-z0-9_-]{1,100}$/.test(value)
    ? value
    : "reconciliation_failed";
}

function timestampWindow(attemptedAt: string): {
  oldest: string;
  latest: string;
} | null {
  const timestamp = Date.parse(attemptedAt);
  if (!Number.isFinite(timestamp)) return null;

  return {
    oldest: ((timestamp - RECONCILIATION_WINDOW_MS) / 1000).toFixed(6),
    latest: ((timestamp + RECONCILIATION_WINDOW_MS) / 1000).toFixed(6),
  };
}

function hasDeliveryKey(
  message: SlackDeliveryMessage,
  deliveryKey: string
): message is SlackDeliveryMessage & { ts: string } {
  if (typeof message.ts !== "string") return false;
  if (message.metadata?.event_type !== DELIVERY_EVENT_TYPE) return false;
  const payload = message.metadata.event_payload;
  return (
    Boolean(payload) &&
    typeof payload === "object" &&
    (payload as Record<string, unknown>).outbox_event_id === deliveryKey
  );
}

async function canReadMessageMetadata(
  client: WebClient
): Promise<{ ok: true } | { ok: false; errorCode: string }> {
  if (!client.token) {
    return { ok: false, errorCode: "missing_reconciliation_token" };
  }

  try {
    const response = await fetch(new URL("auth.test", client.slackApiUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${client.token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      signal: AbortSignal.timeout(SCOPE_CHECK_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      error?: unknown;
    } | null;

    if (!response.ok || body?.ok !== true) {
      return {
        ok: false,
        errorCode:
          typeof body?.error === "string"
            ? boundedSlackProviderCode({ data: { error: body.error } })
            : "reconciliation_scope_check_failed",
      };
    }

    const grantedScopes = response.headers
      .get("x-oauth-scopes")
      ?.split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
    if (!grantedScopes) {
      return { ok: false, errorCode: "reconciliation_scopes_unverified" };
    }
    if (!grantedScopes.includes(METADATA_READ_SCOPE)) {
      return { ok: false, errorCode: "missing_metadata_read_scope" };
    }

    return { ok: true };
  } catch {
    return { ok: false, errorCode: "reconciliation_scope_check_failed" };
  }
}

/**
 * Reconcile an ambiguous Slack post by reading the narrow provider time window
 * around the previous attempt and matching the outbox id stored in message
 * metadata. A failed lookup is distinct from an empty lookup: callers must not
 * post again when they cannot prove that the first delivery is absent.
 */
export async function findSlackDeliveryByMetadata(args: {
  client: WebClient;
  channelId: string;
  deliveryKey: string;
  attemptedAt: string;
  threadTs?: string;
}): Promise<SlackDeliveryReconciliationResult> {
  const window = timestampWindow(args.attemptedAt);
  if (!window) {
    return { ok: false, errorCode: "invalid_reconciliation_window" };
  }

  try {
    const metadataAccess = await canReadMessageMetadata(args.client);
    if (!metadataAccess.ok) return metadataAccess;

    const response = args.threadTs
      ? await args.client.conversations.replies({
          channel: args.channelId,
          ts: args.threadTs,
          include_all_metadata: true,
          inclusive: true,
          limit: RECONCILIATION_PAGE_LIMIT,
          ...window,
        })
      : await args.client.conversations.history({
          channel: args.channelId,
          include_all_metadata: true,
          inclusive: true,
          limit: RECONCILIATION_PAGE_LIMIT,
          ...window,
        });

    const page = response as SlackDeliveryPage;
    const messages = Array.isArray(page.messages)
      ? (page.messages as SlackDeliveryMessage[])
      : [];
    const match = messages.find((message) =>
      hasDeliveryKey(message, args.deliveryKey)
    );
    if (match) return { ok: true, messageTs: match.ts };

    const nextCursor = page.response_metadata?.next_cursor;
    if (
      page.has_more === true ||
      (typeof nextCursor === "string" && nextCursor.trim().length > 0)
    ) {
      return { ok: false, errorCode: "reconciliation_window_truncated" };
    }

    return { ok: true, messageTs: null };
  } catch (error) {
    return { ok: false, errorCode: boundedSlackProviderCode(error) };
  }
}
