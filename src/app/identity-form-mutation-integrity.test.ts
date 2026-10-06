import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const identityForms = [
  [
    "admin user creation",
    "src/app/(auth)/admin/users/create-user-form.tsx",
  ],
  [
    "admin user editing",
    "src/app/(auth)/admin/users/[id]/edit-user-form.tsx",
  ],
  [
    "team-member creation",
    "src/app/(auth)/team/create-team-member-form.tsx",
  ],
  [
    "team-member editing",
    "src/app/(auth)/team/[id]/edit-team-member-form.tsx",
  ],
] as const;

const sources = new Map(
  identityForms.map(([name, path]) => [
    name,
    readFileSync(join(root, path), "utf8"),
  ])
);

const english = JSON.parse(
  readFileSync(join(root, "messages/en.json"), "utf8")
) as { team: { member: { inactiveNotice: string } } };

describe("identity form mutation integrity", () => {
  it.each(identityForms)("contains expected %s failures", (name) => {
    const source = sources.get(name)!;

    expect(source).toMatch(/assertClientMutationResponse|readClientJsonResponse/);
    expect(source).toMatch(/aria-busy=\{(saving|busy)\}/);
    expect(source).toMatch(/role=\{message\.type === "error" \? "alert" : "status"\}|role="alert"/);
    expect(source).not.toContain("await res.json()");
    expect(source).not.toContain("instanceof Error");
  });

  it("contains raw API failures behind bounded or translated copy", () => {
    expect(sources.get("admin user creation")).toContain("clientMutationErrorMessage");
    expect(sources.get("admin user editing")).toContain("clientMutationErrorMessage");
    expect(sources.get("team-member creation")).toContain('t("failed")');
    expect(sources.get("team-member creation")).toContain('"USER_EMAIL_EXISTS"');
    expect(sources.get("team-member editing")).toContain('t("failed")');
  });

  it.each([
    ["admin user creation", "if (busy) return;"],
    ["team-member creation", "if (busy) return;"],
    ["admin user editing", "if (saving || isInactive) return;"],
    ["team-member editing", "if (saving || isInactive) return;"],
  ])("guards duplicate or read-only %s submissions", (name, guard) => {
    expect(sources.get(name)!).toContain(guard);
  });

  it.each([
    ["admin user creation", "admin-create-user"],
    ["team-member creation", "team-create-user"],
  ])("bounds and locks %s identity fields", (name, idPrefix) => {
    const source = sources.get(name)!;

    expect(source).toContain(`id="${idPrefix}-email"`);
    expect(source).toContain("maxLength={320}");
    expect(source).toContain(`id="${idPrefix}-password"`);
    expect(source).toContain("minLength={12}");
    expect(source).toContain("maxLength={128}");
    expect(source).toContain(`id="${idPrefix}-name"`);
    expect(source).toContain(`id="${idPrefix}-locale"`);
    // These fields describe someone else, so the inviter's own identity must
    // not be autofilled into them.
    expect(source).not.toContain('autoComplete="name"');
    expect(source).toContain("maxLength={200}");
    expect(source).toContain("disabled={busy}");
  });

  it.each([
    ["team-member creation", 't("sites")', "disabled={busy}"],
    [
      "team-member editing",
      't("siteAccess")',
      "disabled={saving || isInactive}",
    ],
  ])("groups and locks %s site choices", (name, legend, disabledState) => {
    const source = sources.get(name)!;

    expect(source).toContain(`<fieldset ${disabledState}>`);
    expect(source).toContain("<legend");
    expect(source).toContain(legend);
    expect(source).toContain("aria-pressed={selectedSites.includes(site.id)}");
    expect(source).toContain(disabledState);
  });

  it("keeps inactive identity records read-only", () => {
    for (const name of ["admin user editing", "team-member editing"]) {
      const source = sources.get(name)!;

      expect(source).toContain('const isInactive = user.status === "inactive"');
      expect(source).toContain("disabled={saving || isInactive}");
    }
    expect(sources.get("admin user editing")).toContain("inactive and read-only");
    expect(sources.get("team-member editing")).toContain('t("inactiveNotice")');
    expect(english.team.member.inactiveNotice).toContain("inactive and read-only");
  });

  it("binds editable team-member labels to their controls", () => {
    const source = sources.get("team-member editing")!;

    expect(source).toContain('htmlFor="team-member-full-name"');
    expect(source).toContain('id="team-member-full-name"');
    expect(source).toContain('htmlFor="team-member-status"');
    expect(source).toContain('id="team-member-status"');
  });
});
