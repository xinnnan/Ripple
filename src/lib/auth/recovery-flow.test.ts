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
    expect(forgotPasswordPage).toContain("If an account matches");
    expect(forgotPasswordPage).not.toContain("User not found");
  });

  it("requires a recovery session and a twelve-character password", () => {
    expect(resetPasswordPage).toContain("supabase.auth.getUser()");
    expect(resetPasswordPage).toContain("supabase.auth.updateUser");
    expect(resetPasswordPage).toContain("password.length < 12");
    expect(resetPasswordPage).toContain("minLength={12}");
  });

  it("returns sign-out users to the current application origin", () => {
    expect(logoutRoute).toContain("status: 303");
    expect(logoutRoute).toContain('Location: "/login"');
    expect(logoutRoute).not.toContain("NEXT_PUBLIC_APP_URL");
  });
});
