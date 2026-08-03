import { describe, expect, it } from "vitest";
import {
  DEFAULT_FROM_EMAIL,
  isEmailAddressConfigured,
  isResendApiKeyConfigured,
  resolveEmailFromAddress,
} from "./config";

describe("transactional email configuration", () => {
  it("uses the configured sender or the safe default", () => {
    expect(resolveEmailFromAddress(" alerts@dropletai.services ")).toBe(
      "alerts@dropletai.services"
    );
    expect(resolveEmailFromAddress(undefined)).toBe(DEFAULT_FROM_EMAIL);
  });

  it.each([
    "Ripple Support <support@example.com>",
    "support@example.com\r\nBcc:evil@example.com",
    "support@example.com:443",
    ".support@example.com",
    "support..team@example.com",
    "support@example",
  ])("rejects an invalid sender address: %s", (value) => {
    expect(isEmailAddressConfigured(value)).toBe(false);
    expect(() => resolveEmailFromAddress(value)).toThrow(
      "EMAIL_FROM must be a valid email address"
    );
  });

  it("accepts only non-placeholder Resend API keys", () => {
    expect(isResendApiKeyConfigured("re_live_1234567890")).toBe(true);
    expect(isResendApiKeyConfigured("re_your-resend-key")).toBe(false);
    expect(isResendApiKeyConfigured("sk_wrong-provider-key")).toBe(false);
    expect(isResendApiKeyConfigured(undefined)).toBe(false);
  });
});
