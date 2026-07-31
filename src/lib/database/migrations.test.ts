import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("migration 037 qualified SQL expression repair", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/037_repair_qualified_sql_expressions.sql"
    ),
    "utf8"
  );

  it("repairs every affected deployed atomic command from its definition", () => {
    expect(migration).toContain("pg_catalog.pg_get_functiondef");
    expect(migration).toContain("pg_catalog.to_regprocedure");
    expect(migration).toContain("'pg_catalog.coalesce('");
    expect(migration).toContain("'pg_catalog.nullif('");
    expect(migration).toContain("EXECUTE v_repaired");
    expect(migration).toContain("create_spare_part_request_atomic");
    expect(migration).toContain("create_field_service_order_atomic");
    expect(migration).toContain("apply_field_service_order_patch");
    expect(migration).toContain("apply_team_member_patch");
    expect(migration).toContain("create_admin_site_atomic");
    expect(migration).toContain("apply_admin_site_patch");
  });

  it("fails closed and re-hardens each execution boundary", () => {
    expect(migration).toMatch(/BEGIN;[\s\S]+COMMIT;/);
    expect(migration).toContain("Expected command is missing");
    expect(migration.match(/FROM PUBLIC, anon, authenticated;/g)).toHaveLength(
      6
    );
    expect(migration.match(/TO service_role;/g)).toHaveLength(6);
  });
});
