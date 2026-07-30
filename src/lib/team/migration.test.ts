import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/031_atomic_team_site_assignment.sql"
  ),
  "utf8"
);
const route = readFileSync(
  join(process.cwd(), "src/app/api/team/[id]/route.ts"),
  "utf8"
);

describe("migration 031 team-site assignment integrity", () => {
  it("keeps profile, membership, and audit writes in one command", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.apply_team_member_patch"
    );
    expect(migration).toContain("UPDATE public.users");
    expect(migration).toContain("DELETE FROM public.site_members");
    expect(migration).toContain("INSERT INTO public.site_members");
    expect(migration).toContain("INSERT INTO public.audit_logs");
    expect(route).toContain("applyTeamMemberPatch");
    expect(route).not.toContain('.from("site_members")');
    expect(route).not.toMatch(
      /\.from\("users"\)[\s\S]{0,120}\.update\(/
    );
  });

  it("row-locks the target and existing memberships", () => {
    expect(migration).toContain("WHERE u.id = p_target_user_id");
    expect(migration.match(/FOR UPDATE/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("ORDER BY sm.site_id");
  });

  it("uses a set diff that preserves retained membership roles", () => {
    expect(migration).toContain(
      "AND NOT (sm.site_id = ANY(v_site_ids))"
    );
    expect(migration).toContain("WHERE NOT EXISTS");
    expect(migration).not.toContain(
      "DELETE FROM public.site_members AS sm\n    WHERE sm.user_id = p_target_user_id;"
    );
  });

  it("validates manager, tenant, target role, and every desired site", () => {
    expect(migration).toContain("u.role = 'customer_manager'");
    expect(migration).toContain("u.status = 'active'");
    expect(migration).toContain("c.status IN ('active', 'trial')");
    expect(migration).toContain(
      "v_target.customer_id IS DISTINCT FROM v_actor_customer_id"
    );
    expect(migration).toContain("v_target.role <> 'customer'");
    expect(migration).toContain("s.customer_id = v_actor_customer_id");
    expect(migration).toContain("s.status = 'active'");
    expect(migration).toContain("Duplicate site assignment");
  });

  it("limits the security-definer command to the service role", () => {
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toMatch(
      /FROM PUBLIC, anon, authenticated[\s\S]+TO service_role/
    );
  });
});
