import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/025_archive_lifecycle_and_active_account_guards.sql"
  ),
  "utf8"
);

describe("archive containment migration", () => {
  it("enforces active accounts with restrictive RLS", () => {
    expect(migration).toContain("current_user_is_active()");
    expect(migration).toContain("AS RESTRICTIVE FOR ALL TO authenticated");
    expect(migration).toContain("'audit_logs'");
    expect(migration).toContain("'sla_policies'");
  });

  it("limits direct profile updates to customer-editable columns", () => {
    expect(migration).toContain(
      "GRANT UPDATE (full_name, phone, avatar_url) ON public.users TO authenticated"
    );
  });

  it("removes direct ticket mutation policies", () => {
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Anyone can create tickets"'
    );
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON public.tickets FROM anon, authenticated"
    );
  });

  it("keeps lifecycle change and audit writes inside database functions", () => {
    for (const command of [
      "archive_customers",
      "archive_sites",
      "deactivate_users",
    ]) {
      expect(migration).toContain(`FUNCTION public.${command}`);
    }
    // Customer archive records customer + child site + child user changes;
    // site archive and user deactivation each add one more audit write.
    expect(migration.match(/INSERT INTO public\.audit_logs/g)?.length).toBe(5);
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.archive_customers(uuid[], uuid) TO service_role"
    );
  });
});
