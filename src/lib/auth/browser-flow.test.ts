import { describe, expect, it } from "vitest";
import {
  getLoginErrorMessage,
  getRecoveryErrorMessage,
  getResetPasswordErrorMessage,
  isAuthRateLimitError,
  isInvalidCredentialsError,
  isRecoveryLookupMiss,
  LOGIN_GENERIC_ERROR,
  LOGIN_INVALID_CREDENTIALS_ERROR,
  LOGIN_RATE_LIMIT_ERROR,
  RECOVERY_GENERIC_ERROR,
  RECOVERY_RATE_LIMIT_ERROR,
  RESET_PASSWORD_GENERIC_ERROR,
  RESET_PASSWORD_RATE_LIMIT_ERROR,
} from "./browser-flow";

describe("browser authentication error contracts", () => {
  it("recognizes invalid credentials without using provider messages", () => {
    const error = {
      code: "invalid_credentials",
      message: "provider detail that must not reach the UI",
    };

    expect(isInvalidCredentialsError(error)).toBe(true);
    expect(getLoginErrorMessage(error)).toBe(LOGIN_INVALID_CREDENTIALS_ERROR);
    expect(getLoginErrorMessage(error)).not.toContain(error.message);
  });

  it.each([
    { status: 429 },
    { code: "over_request_rate_limit" },
    { code: "over_email_send_rate_limit" },
  ])("recognizes rate limiting from %#", (error) => {
    expect(isAuthRateLimitError(error)).toBe(true);
    expect(getLoginErrorMessage(error)).toBe(LOGIN_RATE_LIMIT_ERROR);
    expect(getRecoveryErrorMessage(error)).toBe(RECOVERY_RATE_LIMIT_ERROR);
    expect(getResetPasswordErrorMessage(error)).toBe(
      RESET_PASSWORD_RATE_LIMIT_ERROR
    );
  });

  it("uses stable generic messages for unknown and thrown failures", () => {
    const providerError = {
      code: "provider_unavailable",
      status: 503,
      message: "sensitive provider detail",
    };

    expect(getLoginErrorMessage(providerError)).toBe(LOGIN_GENERIC_ERROR);
    expect(getRecoveryErrorMessage(providerError)).toBe(
      RECOVERY_GENERIC_ERROR
    );
    expect(getResetPasswordErrorMessage(providerError)).toBe(
      RESET_PASSWORD_GENERIC_ERROR
    );
    expect(getLoginErrorMessage(new Error("network detail"))).toBe(
      LOGIN_GENERIC_ERROR
    );
  });

  it.each(["user_not_found", "email_not_found"])(
    "recognizes recovery lookup miss %s without provider text",
    (code) => {
      expect(
        isRecoveryLookupMiss({ code, message: "account-specific detail" })
      ).toBe(true);
    }
  );
});
