// Slack request signature verification.
// Refs: https://api.slack.com/authentication/verifying-requests-from-slack
//
// Use before parsing the body. Missing configuration fails closed with a
// distinct reason so routes can return 503; unauthenticated requests return
// 401. There is no local bypass because a deployed environment is not safely
// distinguishable from a developer machine at this trust boundary.

import crypto from "crypto";
import { isSlackSigningSecretConfigured } from "./config";

const FIVE_MINUTES = 5 * 60;

export type SlackSignatureFailureReason =
  | "missing_signing_secret"
  | "missing_headers"
  | "bad_timestamp"
  | "stale_timestamp"
  | "bad_signature";

export type SlackSignatureResult =
  | { ok: true }
  | { ok: false; reason: SlackSignatureFailureReason };

export function verifySlackSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  signingSecret: string | null
): SlackSignatureResult {
  if (!isSlackSigningSecretConfigured(signingSecret)) {
    return { ok: false, reason: "missing_signing_secret" };
  }
  if (!signature || !timestamp) {
    return { ok: false, reason: "missing_headers" };
  }
  if (!/^\d+$/.test(timestamp)) {
    return { ok: false, reason: "bad_timestamp" };
  }
  const ts = Number(timestamp);
  if (!Number.isSafeInteger(ts)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(Date.now() / 1000 - ts) > FIVE_MINUTES) {
    return { ok: false, reason: "stale_timestamp" };
  }
  if (!/^v0=[0-9a-f]{64}$/i.test(signature)) {
    return { ok: false, reason: "bad_signature" };
  }
  const base = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(base)
      .digest("hex");
  // constant-time compare
  if (
    expected.length !== signature.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}

export function getSlackSignatureFailureHttpStatus(
  result: SlackSignatureResult
): 401 | 503 | null {
  if (result.ok) return null;
  return result.reason === "missing_signing_secret" ? 503 : 401;
}
