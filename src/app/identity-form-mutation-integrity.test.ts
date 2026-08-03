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

describe("identity form mutation integrity", () => {
  it.each(identityForms)("contains expected %s failures", (name) => {
    const source = sources.get(name)!;

    expect(source).toContain("assertClientMutationResponse");
    expect(source).toContain("clientMutationErrorMessage");
    expect(source).toContain("await assertClientMutationResponse");
    expect(source).toContain("aria-busy={saving}");
    expect(source).toContain(
      'role={message.type === "error" ? "alert" : "status"}'
    );
    expect(source).not.toContain("await res.json()");
    expect(source).not.toContain("instanceof Error");
  });

  it.each([
    ["admin user creation", "if (saving) return;"],
    ["team-member creation", "if (saving) return;"],
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
    expect(source).toContain('autoComplete="name"');
    expect(source).toContain("maxLength={200}");
    expect(source).toContain("disabled={saving}");
  });

  it.each([
    ["team-member creation", "Assign Sites", "disabled={saving}"],
    [
      "team-member editing",
      "Site Access",
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
      expect(source).toContain("inactive and read-only");
    }
  });

  it("binds editable team-member labels to their controls", () => {
    const source = sources.get("team-member editing")!;

    expect(source).toContain('htmlFor="team-member-full-name"');
    expect(source).toContain('id="team-member-full-name"');
    expect(source).toContain('htmlFor="team-member-status"');
    expect(source).toContain('id="team-member-status"');
  });
});
