import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/055_customer_membership_foundation.sql"
  ),
  "utf8"
);

describe("migration 055 customer authorization foundation", () => {
  it("is one additive transaction and leaves compatibility reads active", () => {
    expect(migration).toMatch(/BEGIN;[\s\S]+COMMIT;/);
    expect(migration).toContain("CREATE TABLE public.customer_memberships");
    expect(migration).toContain("CREATE TABLE public.customer_site_assignments");
    expect(migration).not.toMatch(/DROP (?:TABLE|COLUMN)/i);
    expect(migration).toContain("Compatibility-only home customer");
    expect(migration).toContain("Compatibility-only site access");
  });

  it("models membership role, lifecycle, ticket scope, approvals, and time", () => {
    for (const value of [
      "organization_admin",
      "site_admin",
      "requester",
      "viewer",
      "invited",
      "active",
      "suspended",
      "revoked",
      "OWN",
      "SITE",
      "CUSTOMER",
      "onsite_appointment",
      "paid_service",
      "paid_parts",
      "out_of_scope_work",
    ]) {
      expect(migration).toContain(`'${value}'`);
    }
    expect(migration).toContain("effective_to > effective_from");
    expect(migration).toContain("version >= 1");
  });

  it("makes a cross-customer site assignment structurally impossible", () => {
    expect(migration).toContain("FOREIGN KEY (membership_id, customer_id)");
    expect(migration).toContain(
      "REFERENCES public.customer_memberships(id, customer_id)"
    );
    expect(migration).toContain("FOREIGN KEY (site_id, customer_id)");
    expect(migration).toContain("REFERENCES public.sites(id, customer_id)");
  });

  it("backfills home and retained-site membership paths without widening managers", () => {
    expect(migration).toContain("membership_sources AS MATERIALIZED");
    expect(migration).toContain("app_user.role = 'customer'");
    expect(migration).toContain("app_user.role = 'customer_manager'");
    expect(migration).toContain("AND source.is_home_customer");
    expect(migration).toContain("THEN 'organization_admin'");
    expect(migration).toContain("THEN 'CUSTOMER'");
    expect(migration).toContain("ELSE 'SITE'");
  });

  it("maps every legacy site role and records migration evidence", () => {
    expect(migration).toContain("WHEN 'owner' THEN 'site_admin'");
    expect(migration).toContain("WHEN 'manager' THEN 'site_admin'");
    expect(migration).toContain("WHEN 'viewer' THEN 'viewer'");
    expect(migration).toContain("ELSE 'requester'");
    expect(migration).toContain(
      "migration_055_backfill_customer_membership"
    );
    expect(migration).toContain(
      "migration_055_backfill_customer_site_assignment"
    );
  });

  it("keeps both new roots service-only until policy cutover", () => {
    expect(migration).toContain(
      "ALTER TABLE public.customer_memberships ENABLE ROW LEVEL SECURITY"
    );
    expect(migration).toContain(
      "ALTER TABLE public.customer_site_assignments ENABLE ROW LEVEL SECURITY"
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE[\s\S]+FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toMatch(
      /GRANT SELECT ON TABLE[\s\S]+TO service_role;/
    );
  });
});
