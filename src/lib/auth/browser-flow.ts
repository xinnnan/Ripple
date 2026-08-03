export const LOGIN_GENERIC_ERROR =
  "We could not sign you in. Please try again.";
export const LOGIN_INVALID_CREDENTIALS_ERROR =
  "The email or password is incorrect.";
export const LOGIN_RATE_LIMIT_ERROR =
  "Too many sign-in attempts. Wait a few minutes before trying again.";
export const RECOVERY_GENERIC_ERROR =
  "We could not send a recovery email right now. Please try again.";
export const RECOVERY_RATE_LIMIT_ERROR =
  "Too many requests. Wait a few minutes before trying again.";
export const RESET_PASSWORD_GENERIC_ERROR =
  "We could not update your password. Request a new recovery link.";
export const RESET_PASSWORD_RATE_LIMIT_ERROR =
  "Too many password attempts. Wait a few minutes or request a new recovery link.";

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

export function getLoginErrorMessage(error: unknown): string {
  if (isInvalidCredentialsError(error)) {
    return LOGIN_INVALID_CREDENTIALS_ERROR;
  }
  if (isAuthRateLimitError(error)) return LOGIN_RATE_LIMIT_ERROR;
  return LOGIN_GENERIC_ERROR;
}

export function getRecoveryErrorMessage(error: unknown): string {
  return isAuthRateLimitError(error)
    ? RECOVERY_RATE_LIMIT_ERROR
    : RECOVERY_GENERIC_ERROR;
}

export function getResetPasswordErrorMessage(error: unknown): string {
  return isAuthRateLimitError(error)
    ? RESET_PASSWORD_RATE_LIMIT_ERROR
    : RESET_PASSWORD_GENERIC_ERROR;
}
