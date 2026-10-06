/**
 * Message keys (namespace `authErrors`) rather than sentences, so every auth
 * page renders them in the visitor's language. Provider messages are never
 * shown to users.
 */
export const LOGIN_GENERIC_ERROR = "loginGeneric";
export const LOGIN_INVALID_CREDENTIALS_ERROR = "loginInvalidCredentials";
export const LOGIN_RATE_LIMIT_ERROR = "loginRateLimited";
export const RECOVERY_GENERIC_ERROR = "recoveryGeneric";
export const RECOVERY_RATE_LIMIT_ERROR = "recoveryRateLimited";
export const RESET_PASSWORD_GENERIC_ERROR = "resetGeneric";
export const RESET_PASSWORD_RATE_LIMIT_ERROR = "resetRateLimited";

export type AuthErrorKey =
  | typeof LOGIN_GENERIC_ERROR
  | typeof LOGIN_INVALID_CREDENTIALS_ERROR
  | typeof LOGIN_RATE_LIMIT_ERROR
  | typeof RECOVERY_GENERIC_ERROR
  | typeof RECOVERY_RATE_LIMIT_ERROR
  | typeof RESET_PASSWORD_GENERIC_ERROR
  | typeof RESET_PASSWORD_RATE_LIMIT_ERROR;

interface BrowserAuthError {
  code?: unknown;
  status?: unknown;
}

function getAuthError(error: unknown): BrowserAuthError {
  return typeof error === "object" && error !== null
    ? (error as BrowserAuthError)
    : {};
}

export function isInvalidCredentialsError(error: unknown): boolean {
  return getAuthError(error).code === "invalid_credentials";
}

export function isAuthRateLimitError(error: unknown): boolean {
  const authError = getAuthError(error);
  return (
    authError.status === 429 ||
    authError.code === "over_request_rate_limit" ||
    authError.code === "over_email_send_rate_limit"
  );
}

/** Preserve the recovery form's account-enumeration-resistant success state. */
export function isRecoveryLookupMiss(error: unknown): boolean {
  const code = getAuthError(error).code;
  return code === "user_not_found" || code === "email_not_found";
}

export function getLoginErrorMessage(error: unknown): AuthErrorKey {
  if (isInvalidCredentialsError(error)) {
    return LOGIN_INVALID_CREDENTIALS_ERROR;
  }
  if (isAuthRateLimitError(error)) return LOGIN_RATE_LIMIT_ERROR;
  return LOGIN_GENERIC_ERROR;
}

export function getRecoveryErrorMessage(error: unknown): AuthErrorKey {
  return isAuthRateLimitError(error)
    ? RECOVERY_RATE_LIMIT_ERROR
    : RECOVERY_GENERIC_ERROR;
}

export function getResetPasswordErrorMessage(error: unknown): AuthErrorKey {
  return isAuthRateLimitError(error)
    ? RESET_PASSWORD_RATE_LIMIT_ERROR
    : RESET_PASSWORD_GENERIC_ERROR;
}
