import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/027_restrict_ticket_columns_and_storage.sql"
  ),
  "utf8"
);

const sensitiveColumns = [
  "secure_token",
  "submitter_name",
  "submitter_email",
  "submitter_phone",
  "internal_summary",
  "root_cause_category",
  "follow_up_needed",
];

describe("migration 027 direct-data containment", () => {
  it("removes broad ticket SELECT before granting an explicit projection", () => {
    expect(migration).toMatch(
      /REVOKE SELECT ON public\.tickets FROM PUBLIC, anon, authenticated/i
    );
    expect(migration).toMatch(
      /GRANT SELECT\s*\([\s\S]+?\)\s*ON public\.tickets TO authenticated/i
    );
    expect(migration).not.toMatch(
      /GRANT SELECT ON public\.tickets TO authenticated/i
    );
  });

  it.each(sensitiveColumns)(
    "does not grant the %s ticket column to authenticated",
    (column) => {
      const grant = migration.match(
        /GRANT SELECT\s*\(([\s\S]+?)\)\s*ON public\.tickets TO authenticated/i
      );
      expect(grant).not.toBeNull();
      const grantedColumns = grant![1]
        .split(",")
        .map((value) => value.trim().toLowerCase());
      expect(grantedColumns).not.toContain(column);
    }
  );

  it("keeps customer-facing dashboard fields directly readable", () => {
    for (const column of [
      "id",
      "ticket_no",
      "site_id",
      "title",
      "severity",
      "status",
      "created_at",
      "customer_visible_summary",
    ]) {
      expect(migration).toMatch(new RegExp(`\\b${column}\\b`, "i"));
    }
  });

  it("removes direct authenticated attachment bucket policies", () => {
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Users can upload attachments" ON storage.objects'
    );
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Users can read attachments" ON storage.objects'
    );
    expect(migration).not.toMatch(
      /CREATE POLICY "Users can (?:upload|read) attachments"/i
    );
  });
});
