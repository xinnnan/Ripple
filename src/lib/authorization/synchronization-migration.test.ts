import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/056_synchronize_customer_authorization.sql"
  ),
  "utf8"
);

function functionBody(name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = migration.match(
    new RegExp(
      `CREATE(?: OR REPLACE)? FUNCTION public\\.${escapedName}\\([\\s\\S]+?\\n\\$\\$;`
    )
  );

  expect(match, `${name} should exist`).not.toBeNull();
  return match![0];
}

const wrappers = [
  "apply_team_member_patch",
  "add_admin_site_membership_atomic",
  "remove_admin_site_membership_atomic",
  "apply_admin_user_patch",
  "deactivate_users",
  "finalize_team_user_creation",
  "archive_customers",
] as const;

describe("migration 056 compatibility authorization synchronization", () => {
  it("runs the replacement and synchronization boundary in one transaction", () => {
    expect(migration).toMatch(/^--[\s\S]+\nBEGIN;[\s\S]+\nCOMMIT;\s*$/);
    expect(migration).not.toMatch(/DROP (?:TABLE|COLUMN)/i);
    expect(migration).toContain("users.customer_id");
    expect(migration).toContain("public.site_members");
  });

  it("keeps the synchronizer internal, definer-owned, and fail-closed", () => {
    const sync = functionBody("sync_customer_authorization_from_legacy");

    expect(sync).toContain("SECURITY DEFINER");
    expect(sync).toContain("SET search_path = ''");
    expect(sync).toContain("pg_catalog.pg_advisory_xact_lock(71618056001");
    expect(sync).toContain("actor.status = 'active'");
    expect(sync).toContain("actor.role IN ('admin', 'customer_manager')");
    expect(sync).toContain("FOR UPDATE OF target");
    expect(sync.indexOf("v_now := pg_catalog.clock_timestamp()")).toBeGreaterThan(
      sync.indexOf("FOR UPDATE OF assignment")
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.sync_customer_authorization_from_legacy\([\s\S]+?FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.sync_customer_authorization_from_legacy/
    );
  });

  it("derives exactly the migration-055 compatibility membership sources", () => {
    const sync = functionBody("sync_customer_authorization_from_legacy");

    expect(sync).toContain("membership_sources AS MATERIALIZED");
    expect(sync).toContain("v_target.role IN ('customer_manager', 'customer')");
    expect(sync).toContain("v_target.role = 'customer'");
    expect(sync).toContain("pg_catalog.bool_or(source.is_home_customer)");
    expect(sync).toContain("THEN 'organization_admin'");
    expect(sync).toContain("THEN 'site_admin'");
    expect(sync).toContain("THEN 'viewer'");
    expect(sync).toContain("ELSE 'requester'");
    expect(sync).toContain("THEN 'CUSTOMER'");
    expect(sync).toContain("ELSE 'SITE'");
  });

  it("maps compatibility lifecycle without granting inactive accounts", () => {
    const sync = functionBody("sync_customer_authorization_from_legacy");

    expect(sync).toMatch(
      /v_desired_membership_status := CASE v_target\.status[\s\S]+WHEN 'active' THEN 'active'[\s\S]+WHEN 'invited' THEN 'invited'[\s\S]+ELSE 'suspended'/
    );
    expect(sync).not.toMatch(/WHEN 'inactive' THEN 'active'/);
  });

  it("preserves canonical identities and approval capabilities", () => {
    const sync = functionBody("sync_customer_authorization_from_legacy");

    expect(sync).toContain(
      "WHERE membership.id = v_membership_before.id"
    );
    expect(sync).toContain("WHERE assignment.id = v_assignment_before.id");
    expect(sync).not.toMatch(/SET[\s\S]{0,200}approver_capabilities\s*=/);
    expect(sync).not.toMatch(/DELETE FROM public\.customer_(?:memberships|site_assignments)/);
  });

  it("advances versions and emits audit only for real canonical changes", () => {
    const sync = functionBody("sync_customer_authorization_from_legacy");

    expect(sync).toContain("version = v_membership_before.version + 1");
    expect(sync).toContain("version = v_assignment_before.version + 1");
    expect(sync).toMatch(
      /IS DISTINCT FROM\s+v_desired_organization_role/
    );
    expect(sync).toContain("IS DISTINCT FROM v_desired_site_role");
    expect(sync).toContain("v_memberships_changed := v_memberships_changed + 1");
    expect(sync).toContain("v_assignments_changed := v_assignments_changed + 1");
  });

  it("reactivates site grants at the new authorization boundary", () => {
    const sync = functionBody("sync_customer_authorization_from_legacy");

    expect(sync).toMatch(
      /v_assignment_before\.effective_to IS NOT NULL[\s\S]+THEN v_now[\s\S]+ELSE v_assignment_before\.effective_from/
    );
    expect(sync).toContain("effective_to = NULL");
    expect(sync).toContain("revoked_by = NULL");
  });

  it("closes removed grants while retaining valid future-dated history", () => {
    const sync = functionBody("sync_customer_authorization_from_legacy");

    expect(sync).toContain("assignment.effective_to IS NULL");
    expect(sync).toContain("status = 'revoked'");
    expect(sync).toContain("revoked_by = p_actor_id");
    expect(sync.match(/INTERVAL '1 microsecond'/g)).toHaveLength(2);
    expect(sync).toContain("v_now > v_assignment_before.effective_from");
    expect(sync).toContain("v_now > v_membership_before.effective_from");
  });

  it("writes exact canonical audit snapshots with command attribution", () => {
    const sync = functionBody("sync_customer_authorization_from_legacy");

    expect(sync).toContain("'customer_membership'");
    expect(sync).toContain("'customer_site_assignment'");
    expect(sync).toContain("'authorization_snapshot'");
    expect(sync).toContain("pg_catalog.to_jsonb(v_membership_before)::text");
    expect(sync).toContain("pg_catalog.to_jsonb(v_membership_after)::text");
    expect(sync).toContain("pg_catalog.to_jsonb(v_assignment_before)::text");
    expect(sync).toContain("pg_catalog.to_jsonb(v_assignment_after)::text");
    expect(sync).toContain("'sync_customer_authorization_from_legacy'");
  });

  it.each(wrappers)(
    "preserves %s and synchronizes before returning",
    (name) => {
      const wrapper = functionBody(name);
      const legacyCall = wrapper.indexOf(`${name}_legacy_056`);
      const syncCall = wrapper.indexOf(
        "public.sync_customer_authorization_from_legacy"
      );
      const returnStatement = wrapper.lastIndexOf("RETURN");

      expect(wrapper).toContain("SECURITY DEFINER");
      expect(wrapper).toContain("SET search_path = ''");
      expect(legacyCall).toBeGreaterThan(-1);
      expect(syncCall).toBeGreaterThan(legacyCall);
      expect(returnStatement).toBeGreaterThan(syncCall);
    }
  );

  it("retains the target before a compatibility assignment is deleted", () => {
    const wrapper = functionBody("remove_admin_site_membership_atomic");

    expect(wrapper).toContain("SELECT membership.user_id");
    expect(wrapper.indexOf("SELECT membership.user_id")).toBeLessThan(
      wrapper.indexOf("remove_admin_site_membership_atomic_legacy_056")
    );
  });

  it("synchronizes every distinct target in a validated deactivation batch", () => {
    const wrapper = functionBody("deactivate_users");

    expect(wrapper).toContain("SELECT DISTINCT supplied.id");
    expect(wrapper).toContain("FROM pg_catalog.unnest(p_ids)");
    expect(wrapper).toContain("ORDER BY supplied.id");
  });

  it("synchronizes every external user deactivated by customer archival", () => {
    const wrapper = functionBody("archive_customers");

    expect(wrapper).toContain("archive_customers_legacy_056");
    expect(wrapper).toContain("target.customer_id = ANY(p_ids)");
    expect(wrapper).toContain(
      "target.role IN ('customer_manager', 'customer')"
    );
    expect(wrapper).toContain("ORDER BY target.id");
  });

  it.each(wrappers)("makes the prior %s implementation unreachable", (name) => {
    expect(migration).toContain(`RENAME TO ${name}_legacy_056`);
    expect(migration).toMatch(
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}_legacy_056\\([\\s\\S]+?FROM PUBLIC, anon, authenticated, service_role;`
      )
    );
  });

  it.each(wrappers)("keeps the public %s RPC service-only", (name) => {
    expect(migration).toMatch(
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\([\\s\\S]+?FROM PUBLIC, anon, authenticated;`
      )
    );
    expect(migration).toMatch(
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]+?TO service_role;`
      )
    );
  });

  it("does not repeat the invalid SQL-expression qualification defect", () => {
    expect(migration).not.toMatch(/pg_catalog\.(?:coalesce|nullif)\s*\(/i);
  });
});
