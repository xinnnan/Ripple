export const AUTH_SERVICE_UNAVAILABLE = {
  error: "Authentication service unavailable",
  status: 503,
} as const;

interface SafeIdentityReadError {
  code?: string;
  name?: string;
  status?: number;
}

/** Supabase uses this named error for the normal signed-out request path. */
export function isMissingAuthSessionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AuthSessionMissingError"
  );
}

/** Missing, expired, revoked, and otherwise rejected sessions are 401 paths. */
export function isUnauthenticatedAuthError(error: unknown): boolean {
  if (isMissingAuthSessionError(error)) return true;
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }

  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403;
}

/**
 * Keep identity-provider and profile-read diagnostics useful without logging
 * provider messages, SQL details, tokens, or caller data.
 */
export function logIdentityReadFailure(
  context: string,
  error: unknown
): void {
  const safeError =
    typeof error === "object" && error !== null
      ? (error as SafeIdentityReadError)
      : {};

  console.error(`[${context}] identity read failed:`, {
    code: safeError.code || "UNKNOWN",
    name: safeError.name || "UNKNOWN",
    status:
      typeof safeError.status === "number" ? safeError.status : "UNKNOWN",
  });
}

export function identityServiceUnavailable(
  context: string,
  error: unknown
): typeof AUTH_SERVICE_UNAVAILABLE {
  logIdentityReadFailure(context, error);
  return AUTH_SERVICE_UNAVAILABLE;
}

export function throwIdentityServiceUnavailable(
  context: string,
  error: unknown
): never {
  logIdentityReadFailure(context, error);
  throw new Error("Account data is temporarily unavailable");
}
