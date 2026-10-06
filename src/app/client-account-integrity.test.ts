import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const profilePage = readFileSync(
  join(root, "src/app/(auth)/profile/page.tsx"),
  "utf8"
);
const createModal = readFileSync(
  join(root, "src/app/(auth)/tickets/create-ticket-modal.tsx"),
  "utf8"
);
const submitPage = readFileSync(
  join(root, "src/app/(public)/submit/page.tsx"),
  "utf8"
);

const englishMessages = JSON.parse(
  readFileSync(join(process.cwd(), "messages/en.json"), "utf8")
) as {
  submit: { title: string; fields: { siteNoneHelp: string } };
  createTicket: { retrySites: string };
  profile: {
    saveFailed: string;
    password: { failed: string; newPlaceholder: string };
  };
};

describe("browser account and ticket-intake integrity", () => {
  it("always resolves profile loading and exposes retry recovery", () => {
    expect(profilePage).toContain("finally");
    expect(profilePage).toContain("setLoading(false)");
    expect(profilePage).toContain("void loadProfile()");
    expect(profilePage).toContain('t("tryAgain")');
    expect(profilePage).toContain(".maybeSingle()");
  });

  it("does not expose raw profile or password provider messages", () => {
    expect(profilePage).not.toContain("text: error.message");
    expect(profilePage).toContain('t("saveFailed")');
    expect(profilePage).toContain('t("password.failed")');
    expect(englishMessages.profile.saveFailed).toBe(
      "Unable to update your profile. Please try again."
    );
    expect(englishMessages.profile.password.failed).toBe(
      "Unable to update your password. Please try again."
    );
  });

  it("routes profile writes through the authenticated atomic API boundary", () => {
    expect(profilePage).toContain('fetch("/api/profile"');
    expect(profilePage).toContain("assertClientMutationResponse");
    expect(profilePage).toContain("localizedClientMutationError");
    expect(profilePage).not.toMatch(
      /\.from\(["']users["']\)[\s\S]{0,160}\.update\(/
    );
  });

  it("binds and bounds profile controls consistently", () => {
    for (const id of [
      "profile-full-name",
      "profile-phone",
      "profile-new-password",
      "profile-confirm-password",
    ]) {
      expect(profilePage).toContain(`htmlFor=\"${id}\"`);
      expect(profilePage).toContain(`id=\"${id}\"`);
    }
    expect(profilePage).toContain('placeholder={t("password.newPlaceholder")}');
    expect(englishMessages.profile.password.newPlaceholder).toBe(
      "At least 12 characters"
    );
    expect(profilePage).toContain("maxLength={1024}");
    expect(profilePage).not.toContain('placeholder="At least 6 characters"');
    expect(profilePage).toContain('aria-pressed={showPasswords}');
    expect(profilePage).toContain("min-h-11");
    expect(profilePage).toContain(
      'role={passwordMessage.type === "error" ? "alert" : "status"}'
    );
  });

  it("blocks authenticated modal submission when site options are unavailable", () => {
    expect(createModal).toContain("siteLoadError");
    expect(createModal).toContain('t("retrySites")');
    expect(englishMessages.createTicket.retrySites).toBe("Retry site loading");
    expect(createModal).toContain("userSites.length === 0");
    expect(createModal).toContain('role="dialog"');
    expect(createModal).toContain('aria-modal="true"');
  });

  it("does not downgrade public intake identity failures to guest behavior", () => {
    expect(submitPage).toContain("authChecking");
    expect(submitPage).toContain("accountLoadError");
    expect(submitPage).toContain('t("title")');
    expect(englishMessages.submit.title).toBe("Submit a Support Request");
    expect(submitPage).toContain("isUnauthenticatedAuthError");
    expect(submitPage).toContain("public-submit/profile");
    expect(submitPage).not.toContain("Not logged in, continue as guest");
  });

  it("keeps signed-in no-site state distinct from guest site-code entry", () => {
    expect(submitPage).toContain("{isLoggedIn ? (");
    expect(submitPage).toContain('t("fields.siteNoneHelp")');
    expect(englishMessages.submit.fields.siteNoneHelp).toContain(
      "No active sites are assigned to this account"
    );
    expect(submitPage).toContain("isLoggedIn && userSites.length === 0");
  });
});
