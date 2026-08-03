import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const createCustomerForm = readFileSync(
  "src/app/(auth)/admin/customers/create-customer-form.tsx",
  "utf8"
);
const editCustomerForm = readFileSync(
  "src/app/(auth)/admin/customers/[id]/edit-customer-form.tsx",
  "utf8"
);
const createSiteForm = readFileSync(
  "src/app/(auth)/admin/sites/create-site-form.tsx",
  "utf8"
);
const editSiteForm = readFileSync(
  "src/app/(auth)/admin/sites/[id]/edit-site-form.tsx",
  "utf8"
);

const forms = [
  createCustomerForm,
  editCustomerForm,
  createSiteForm,
  editSiteForm,
];

describe("customer and site form mutation integrity", () => {
  it("uses the bounded client error contract without timed full reloads", () => {
    for (const form of forms) {
      expect(form).toContain("assertClientMutationResponse");
      expect(form).toContain("clientMutationErrorMessage");
      expect(form).toContain("aria-busy={busy}");
      expect(form).not.toContain("window.location.reload");
      expect(form).not.toContain("err instanceof Error ? err.message");
    }
  });

  it("normalizes customer identity and locks lifecycle-aware edits", () => {
    expect(createCustomerForm).toContain("name.trim()");
    expect(createCustomerForm).toContain("domain.trim().toLowerCase()");
    expect(createCustomerForm).toContain("disabled={busy}");
    expect(editCustomerForm).toContain("if (busy || isArchived) return");
    expect(editCustomerForm).toContain("disabled={busy || isArchived}");
    expect(editCustomerForm).toContain("maxLength={253}");
  });

  it("shares canonical site-code validation and matches API bounds", () => {
    for (const form of [createSiteForm, editSiteForm]) {
      expect(form).toContain("normalizeSiteCode");
      expect(form).toContain("isValidSiteCode");
      expect(form).toContain("maxLength={SITE_CODE_MAX_LENGTH}");
      expect(form).toContain("maxLength={200}");
      expect(form).toContain("maxLength={500}");
      expect(form).toContain("grid-cols-1");
      expect(form).toContain("md:grid-cols-2");
    }
  });

  it("prevents site creation without an active customer and keeps ownership fixed", () => {
    expect(createSiteForm).toContain("disabled={!hasCustomer}");
    expect(createSiteForm).toContain(
      "Create an active customer before adding a site."
    );
    expect(editSiteForm).toContain("if (busy || isArchived) return");
    expect(editSiteForm).toContain("Customer ownership is fixed");
    expect(editSiteForm).not.toContain("customer_id:");
  });
});
