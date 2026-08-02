import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const homepage = read("src/app/page.tsx");
const submitPage = read("src/app/(public)/submit/page.tsx");
const appShell = read("src/components/app-shell.tsx");
const globalStyles = read("src/styles/globals.css");

describe("public and responsive UI contracts", () => {
  it("uses the supplied automation visual and self-hosted Inter font", () => {
    expect(homepage).toContain("/images/ripple-automation-fleet.jpg");
    expect(homepage).toContain('id="how-it-works"');
    expect(homepage).toContain('id="support-channels"');
    expect(globalStyles).toContain('@import "@fontsource-variable/inter"');
    expect(globalStyles).toContain('"Inter Variable"');
  });

  it("keeps support form controls explicitly labelled", () => {
    for (const id of [
      "site-code",
      "submitter-name",
      "submitter-email",
      "submitter-phone",
      "issue-title",
      "request-type",
      "severity",
      "impact",
      "asset-id",
      "area",
      "description",
    ]) {
      expect(submitPage).toContain(`htmlFor="${id}"`);
      expect(submitPage).toContain(`id="${id}"`);
    }
    expect(submitPage).toContain("await Promise.all");
    expect(submitPage).toContain("attachmentWarning");
    expect(submitPage).toContain('cache: "no-store"');
    expect(submitPage).toContain("controller.abort()");
    expect(submitPage).toContain("aria-invalid={siteCodeValid === false}");
    expect(submitPage).toContain("maxLength={SITE_CODE_MAX_LENGTH}");
  });

  it("provides an accessible mobile application drawer", () => {
    expect(appShell).toContain('aria-controls="mobile-navigation"');
    expect(appShell).toContain('id="mobile-navigation"');
    expect(appShell).toContain('aria-modal="true"');
    expect(appShell).toContain('event.key === "Escape"');
    expect(appShell).toContain("mobileTrigger?.focus()");
  });
});
