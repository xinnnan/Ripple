// Slack request signature verification.
// Refs: https://api.slack.com/authentication/verifying-requests-from-slack
//
// Use before parsing the body. Returns true if the signature is valid OR
// if `SLACK_SIGNING_SECRET` is not set (dev / local).
//
// In production, set SLACK_SIGNING_SECRET and rejections will return 401.

import crypto from "crypto";

const FIVE_MINUTES = 5 * 60;

export function verifySlackSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  signingSecret: string | null
): { ok: boolean; reason?: string } {
  if (!signingSecret) {
    // No secret configured — don't gate (dev mode). The real fix is to
    // set SLACK_SIGNING_SECRET in prod env.
    return { ok: true, reason: "no_signing_secret" };
  }
  if (!signature || !timestamp) {
    return { ok: false, reason: "missing_headers" };
  }
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "bad_timestamp" };
  }
  if (Math.abs(Date.now() / 1000 - ts) > FIVE_MINUTES) {
    return { ok: false, reason: "stale_timestamp" };
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
