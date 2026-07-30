import crypto from "node:crypto";

export function hasValidCronAuthorization(
  authorization: string | null,
  secret = process.env.CRON_SECRET
): boolean {
  if (!secret || !authorization) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);
  return (
    expected.length === received.length &&
    crypto.timingSafeEqual(expected, received)
  );
}
