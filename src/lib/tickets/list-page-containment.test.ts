import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  join(process.cwd(), "src/app/(auth)/tickets/page.tsx"),
  "utf8"
);

describe("authenticated ticket-list page containment", () => {
  it("rejects invalid parsed filters before creating the service-role client", () => {
    const parseIndex = pageSource.indexOf("parseTicketListFilters(params)");
    const invalidIndex = pageSource.indexOf("if (!parsedFilters.isValid)");
    const adminIndex = pageSource.indexOf("const admin = createAdminClient()");

    expect(parseIndex).toBeGreaterThan(-1);
    expect(invalidIndex).toBeGreaterThan(parseIndex);
    expect(adminIndex).toBeGreaterThan(invalidIndex);
  });

  it("uses the shared guarded PostgREST search builder", () => {
    expect(pageSource).toContain("buildTicketSearchFilter(filters.q)");
    expect(pageSource).not.toContain("ticket_no.ilike.%${safe}%");
  });

  it("does not offer a broadened export when page filters are invalid", () => {
    expect(pageSource).toContain("canExport={!filterError}");
  });
});
