import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const callbackRoute = readFileSync(
  resolve(process.cwd(), "src/app/auth/callback/route.ts"),
  "utf8"
);
const loginPage = readFileSync(
  resolve(process.cwd(), "src/app/(public)/login/page.tsx"),
  "utf8"
);
const forgotPasswordPage = readFileSync(
  resolve(process.cwd(), "src/app/(public)/forgot-password/page.tsx"),
  "utf8"
);
const resetPasswordPage = readFileSync(
  resolve(process.cwd(), "src/app/(public)/reset-password/page.tsx"),
  "utf8"
);
const logoutRoute = readFileSync(
  resolve(process.cwd(), "src/app/auth/logout/route.ts"),
  "utf8"
);
const sessionCleanup = readFileSync(
  resolve(process.cwd(), "src/lib/auth/session-cleanup.ts"),
  "utf8"
);

describe("password recovery flow contract", () => {
  it("keeps exchanged auth cookies on the response that is returned", () => {
    expect(callbackRoute).toContain("const successResponse");
    expect(callbackRoute).toContain("successResponse.cookies.set");
    expect(callbackRoute).toContain("return successResponse");
    expect(callbackRoute).toContain("getSafeRedirectPath");
  });

  it("links sign-in to the non-enumerating recovery request", () => {
    expect(loginPage).toContain('href="/forgot-password"');
    expect(forgotPasswordPage).toContain("resetPasswordForEmail");
    expect(forgotPasswordPage).toContain("isRecoveryLookupMiss");
    expect(forgotPasswordPage).toContain("If an account matches");
    expect(forgotPasswordPage).not.toContain("User not found");
  });

  it("uses a full navigation after sign-in so account-state redirects remount", () => {
    expect(loginPage).toContain("window.location.assign(redirectPath)");
    expect(loginPage).not.toContain("router.push(redirectPath)");
    expect(loginPage).toContain('search.get("account") === "inactive"');
  });

  it("requires a recovery session and a twelve-character password", () => {
    expect(resetPasswordPage).toContain("supabase.auth.getUser()");
    expect(resetPasswordPage).toContain("supabase.auth.updateUser");
    expect(resetPasswordPage).toContain('recoveryState === "unavailable"');
    expect(resetPasswordPage).toContain('recoveryState === "invalid"');
    expect(resetPasswordPage).toContain("password.length < 12");
    expect(resetPasswordPage).toContain("minLength={12}");
  });

  it("settles browser auth operations and contains provider detail", () => {
    for (const page of [loginPage, forgotPasswordPage, resetPasswordPage]) {
      expect(page).toContain("finally");
      expect(page).toContain("setLoading(false)");
      expect(page).toContain("logIdentityReadFailure");
      expect(page).not.toContain("setError(updateError.message)");
      expect(page).not.toContain("setError(resetError.message)");
      expect(page).not.toContain("setError(signInError.message)");
    }
  });

  it("distinguishes password success from incomplete session cleanup", () => {
    expect(resetPasswordPage).toContain("endAuthSessions");
    expect(sessionCleanup).toContain('scope: "global"');
    expect(sessionCleanup).toContain('scope: "local"');
    expect(resetPasswordPage).toContain('setRecoveryState("cleanup_failed")');
    expect(resetPasswordPage).toContain("update the password again");
    expect(resetPasswordPage).toContain("sessions=partial");
    expect(loginPage).toContain('search.get("sessions")');
  });

  it("returns sign-out users to the current application origin", () => {
    expect(logoutRoute).toContain("status: 303");
    expect(logoutRoute).toContain('location = "/login"');
    expect(logoutRoute).toContain("endAuthSessions");
    expect(logoutRoute).toContain("signout_failed");
    expect(logoutRoute).not.toContain("NEXT_PUBLIC_APP_URL");
  });

  it("contains callback provider failures on the stable login recovery path", () => {
    expect(callbackRoute).toContain("auth-callback/exchange");
    expect(callbackRoute).toContain("catch (exchangeError)");
    expect(callbackRoute).toContain("auth_callback_failed");
  });
});
