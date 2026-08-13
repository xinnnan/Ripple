import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/054_atomic_admin_slack_identity.sql"
  ),
  "utf8"
);

describe("migration 054 administrator Slack identity mapping", () => {
  it("uses a transaction, definer boundary, empty search path, and service-only grant", () => {
    expect(migration).toMatch(/BEGIN;[\s\S]+COMMIT;/);
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.apply_admin_user_slack_identity\([\s\S]+FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.apply_admin_user_slack_identity\([\s\S]+TO service_role;/
    );
  });

  it("serializes active-admin authorization and locks the target", () => {
    expect(migration.match(/pg_catalog\.pg_advisory_xact_lock/g)).toHaveLength(
      2
    );
    expect(migration).toContain("actor.role = 'admin'");
    expect(migration).toContain("actor.status = 'active'");
    expect(migration).toContain("FOR SHARE OF actor");
    expect(migration).toContain("FOR UPDATE OF target");
  });

  it("normalizes, bounds, and validates a Slack member identity", () => {
    expect(migration).toContain(
      "pg_catalog.upper(pg_catalog.btrim(p_slack_user_id))"
    );
    expect(migration).toContain("NOT BETWEEN 9 AND 50");
    expect(migration).toContain("!~ '^[UW][A-Z0-9]{8,49}$'");
    expect(migration).toContain("Inactive users cannot change Slack identity");
    expect(migration).toContain("users_slack_user_id_shape");
    expect(migration).toContain("An existing Slack user identity has an invalid shape");
  });

  it("normalizes safe legacy values with audit and rejects ambiguous migration", () => {
    expect(migration).toContain(
      "Existing Slack user identities become ambiguous after normalization"
    );
    expect(migration).toContain("WITH before AS MATERIALIZED");
    expect(migration).toContain("'system'");
    expect(migration).toContain("'migration_054_normalize_slack_identity'");
  });

  it("rejects duplicate ownership and preserves exact no-op behavior", () => {
    expect(migration).toContain(
      "existing.slack_user_id = v_slack_user_id"
    );
    expect(migration).toContain("existing.id <> p_target_user_id");
    expect(migration).toContain(
      "v_before.slack_user_id IS NOT DISTINCT FROM v_slack_user_id"
    );
    expect(migration).toContain("RETURN p_target_user_id");
  });

  it("commits the mapping and exact command audit evidence together", () => {
    expect(migration).toContain("UPDATE public.users AS target");
    expect(migration).toContain("SET slack_user_id = v_slack_user_id");
    expect(migration).toContain("INSERT INTO public.audit_logs");
    expect(migration).toContain("'slack_user_id'");
    expect(migration).toContain("v_before.slack_user_id");
    expect(migration).toContain("'apply_admin_user_slack_identity'");
  });

  it("does not repeat the invalid SQL-expression qualification defect", () => {
    expect(migration).not.toMatch(/pg_catalog\.(?:coalesce|nullif)\s*\(/i);
  });
});
