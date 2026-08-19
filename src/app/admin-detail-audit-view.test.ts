import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DETAIL_PAGES = [
  "src/app/(auth)/admin/customers/[id]/page.tsx",
  "src/app/(auth)/admin/sites/[id]/page.tsx",
  "src/app/(auth)/admin/users/[id]/page.tsx",
];

describe("admin detail audit history queries", () => {
  for (const page of DETAIL_PAGES) {
    it(`${page} reads actor names from the enriched audit view`, () => {
      const source = readFileSync(page, "utf8");

      expect(source).toContain('.from("audit_logs_with_actor")');
      expect(source).not.toContain('.from("audit_logs")');
    });
  }
});
