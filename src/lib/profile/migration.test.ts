import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/052_atomic_self_service_profile.sql"
  ),
  "utf8"
);

describe("migration 052 atomic self-service profile boundary", () => {
  it("defines one transaction-scoped, row-locked command", () => {
    expect(migration).toMatch(/BEGIN;[\s\S]+COMMIT;/);
    expect(migration).toContain("public.update_own_profile");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("FOR UPDATE OF actor");
    expect(migration).toContain("actor.status");
    expect(migration).toContain("v_actor_status <> 'active'");
  });

  it("normalizes and bounds only the supported profile fields", () => {
    expect(migration).toContain("pg_catalog.btrim(p_full_name)");
    expect(migration).toContain("pg_catalog.btrim(COALESCE(p_phone, ''))");
    expect(migration).toContain("pg_catalog.char_length(v_full_name) > 200");
    expect(migration).toContain(
      "pg_catalog.char_length(COALESCE(v_phone, '')) > 50"
    );
    expect(migration).not.toMatch(/pg_catalog\.(?:coalesce|nullif)\s*\(/i);
    expect(migration).toContain("'[[:cntrl:]]'");
    expect(migration).not.toMatch(/SET[\s\S]+avatar_url\s*=/i);
  });

  it("writes exact per-field self-service audit evidence", () => {
    expect(migration).toContain("v_old_full_name IS DISTINCT FROM v_full_name");
    expect(migration).toContain("v_old_phone IS DISTINCT FROM v_phone");
    expect(migration.match(/INSERT INTO public\.audit_logs/g)).toHaveLength(2);
    expect(migration).toContain("'source', 'self-service'");
    expect(migration).toContain("'command', 'update_own_profile'");
    expect(migration).toContain("'changed_fields'");
  });

  it("removes direct authenticated writes and exposes only service execution", () => {
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Users can update own profile" ON public.users'
    );
    expect(migration).toMatch(
      /REVOKE UPDATE \(full_name, phone, avatar_url\)\s+ON TABLE public\.users\s+FROM authenticated;/i
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.update_own_profile\(uuid, text, text\)\s+FROM PUBLIC, anon, authenticated;/i
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.update_own_profile\(uuid, text, text\)\s+TO service_role;/i
    );
  });
});
