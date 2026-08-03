import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const fieldServiceForm = readFileSync(
  join(
    root,
    "src/app/(auth)/admin/field-service/create/create-field-service-form.tsx"
  ),
  "utf8"
);
const partRequestForm = readFileSync(
  join(
    root,
    "src/app/(auth)/admin/part-requests/create/create-part-request-form.tsx"
  ),
  "utf8"
);

describe("service creation form mutation integrity", () => {
  it.each([
    ["field-service", fieldServiceForm],
    ["spare-part request", partRequestForm],
  ])("contains expected %s failures through navigation settlement", (_, source) => {
    expect(source).toContain("assertClientMutationResponse");
    expect(source).toContain("clientMutationErrorMessage");
    expect(source).toContain("useTransition");
    expect(source).toContain("const busy = loading || navigating");
    expect(source).toContain("if (busy) return;");
    expect(source).toContain("aria-busy={busy}");
    expect(source).toContain('role="alert"');
    expect(source).not.toContain("await res.json()");
    expect(source).not.toContain("instanceof Error");
  });

  it("aligns field-service text and hour bounds with the server contract", () => {
    expect(fieldServiceForm).toContain('htmlFor="field-service-title"');
    expect(fieldServiceForm).toContain('id="field-service-title"');
    expect(fieldServiceForm).toContain("maxLength={200}");
    expect(fieldServiceForm).toContain(
      'htmlFor="field-service-description"'
    );
    expect(fieldServiceForm).toContain("maxLength={5000}");
    expect(fieldServiceForm).toContain('step="0.1"');
    expect(fieldServiceForm).toContain('max="9999.9"');
    expect(fieldServiceForm).toContain(
      "!Number.isInteger(normalizedEstimatedHours * 10)"
    );
  });

  it("validates field-service dates and bounds engineer assignment", () => {
    expect(fieldServiceForm).toContain(
      "scheduledEndDate < scheduledDate"
    );
    expect(fieldServiceForm).toContain("MAX_ASSIGNED_ENGINEERS = 20");
    expect(fieldServiceForm).toContain("engineerLimitReached");
    expect(fieldServiceForm).toContain("<fieldset disabled={busy || !hasSites}>");
    expect(fieldServiceForm).toContain("first selected engineer is the lead");
    expect(fieldServiceForm).toContain("grid-cols-1");
    expect(fieldServiceForm).toContain("md:grid-cols-2");
  });

  it("keeps every submitted part row explicit and stable", () => {
    expect(partRequestForm).toContain("rowId: number");
    expect(partRequestForm).toContain("key={item.rowId}");
    expect(partRequestForm).toContain("for (const [index, item] of items.entries())");
    expect(partRequestForm).not.toContain("validItems");
    expect(partRequestForm).toContain("Select a spare part for item");
    expect(partRequestForm).toContain("Each spare part can appear only once");
  });

  it("preserves zero prices and enforces exact item bounds", () => {
    expect(partRequestForm).toContain("MAX_REQUEST_ITEMS = 100");
    expect(partRequestForm).toContain("MAX_QUANTITY = 2_147_483_647");
    expect(partRequestForm).toContain("MAX_UNIT_PRICE = 99_999_999.99");
    expect(partRequestForm).toContain("part?.unit_price === null");
    expect(partRequestForm).toContain("unit_price: unitPrice");
    expect(partRequestForm).not.toContain("unit_price: item.unit_price || null");
    expect(partRequestForm).toContain("/^\\d+(?:\\.\\d{1,2})?$/");
  });

  it("binds and bounds request and line-item controls", () => {
    for (const control of [
      "part-request-site",
      "part-request-priority",
      "part-request-notes",
    ]) {
      expect(partRequestForm).toContain(`htmlFor="${control}"`);
      expect(partRequestForm).toContain(`id="${control}"`);
    }
    expect(partRequestForm).toContain("maxLength={500}");
    expect(partRequestForm).toContain("maxLength={5000}");
    expect(partRequestForm).toContain("aria-label={`Remove item");
    expect(partRequestForm).toContain("grid-cols-1");
    expect(partRequestForm).toContain("md:grid-cols-2");
  });
});
