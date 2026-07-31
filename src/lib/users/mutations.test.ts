import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AdminUserMutationError,
  applyAdminUserPatch,
} from "./mutations";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function clientWithRpc(result: {
  data: unknown;
  error: null | { code?: string };
}) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

describe("admin user mutation contract", () => {
  it("sends profile and authorization state through one atomic command", async () => {
    const { client, rpc } = clientWithRpc({ data: USER_ID, error: null });
    const patch = { role: "engineer" as const, status: "active" as const };

    await expect(
      applyAdminUserPatch({
        supabase: client,
        actorId: ACTOR_ID,
        targetUserId: USER_ID,
        patch,
      })
    ).resolves.toBe(USER_ID);

    expect(rpc).toHaveBeenCalledWith("apply_admin_user_patch", {
      p_actor_id: ACTOR_ID,
      p_target_user_id: USER_ID,
      p_patch: patch,
    });
  });

  it("preserves command codes without exposing database messages", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { code: "55000" },
    });

    const operation = applyAdminUserPatch({
      supabase: client,
      actorId: ACTOR_ID,
      targetUserId: USER_ID,
      patch: { role: "customer" },
    });

    await expect(operation).rejects.toMatchObject({
      name: "AdminUserMutationError",
      message: "Atomic admin user update failed",
      code: "55000",
    } satisfies Partial<AdminUserMutationError>);
  });
});

describe("migration 038 admin user integrity", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/038_atomic_admin_user_patch.sql"
    ),
    "utf8"
  );
  const route = readFileSync(
    resolve(process.cwd(), "src/app/api/admin/users/[id]/route.ts"),
    "utf8"
  );
  const editForm = readFileSync(
    resolve(
      process.cwd(),
      "src/app/(auth)/admin/users/[id]/edit-user-form.tsx"
    ),
    "utf8"
  );
  const detailPage = readFileSync(
    resolve(
      process.cwd(),
      "src/app/(auth)/admin/users/[id]/page.tsx"
    ),
    "utf8"
  );

  it("serializes active-admin and target authorization decisions under locks", () => {
    expect(migration.match(/pg_catalog\.pg_advisory_xact_lock/g)).toHaveLength(
      2
    );
    expect(migration).toContain("actor.role = 'admin'");
    expect(migration).toContain("actor.status = 'active'");
    expect(migration).toContain("FOR SHARE OF actor");
    expect(migration).toContain("FOR UPDATE OF target");
    expect(migration).toContain("p_target_user_id = p_actor_id");
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.deactivate_users"
    );
    expect(migration).toContain("ORDER BY target.id");
    expect(migration).toContain("FOR UPDATE OF target");
  });

  it("guards lifecycle, role-family, and external tenant invariants", () => {
    expect(migration).toContain("v_before.status = 'inactive'");
    expect(migration).toContain("v_new_status = 'inactive'");
    expect(migration).toContain(
      "v_before_is_internal IS DISTINCT FROM v_after_is_internal"
    );
    expect(migration).toContain("v_new_role = 'customer_manager'");
    expect(migration).toContain("customer.status IN ('active', 'trial')");
    expect(migration).toContain("FROM public.site_members AS membership");
    expect(migration).toContain(
      "site.customer_id IS DISTINCT FROM v_before.customer_id"
    );
  });

  it("commits one update and per-field audit evidence in one transaction", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain("UPDATE public.users AS target");
    expect(migration).toContain("INSERT INTO public.audit_logs");
    expect(migration).toContain("WHEN changed.field_name = 'role'");
    expect(migration).toContain("WHEN changed.field_name = 'status'");
    expect(migration).toContain("apply_admin_user_patch");
  });

  it("restricts the command and removes route-level writes/audit", () => {
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(2);
    expect(migration).toMatch(
      /FROM PUBLIC, anon, authenticated[\s\S]+TO service_role/
    );
    expect(migration.match(/FROM PUBLIC, anon, authenticated;/g)).toHaveLength(
      2
    );
    expect(migration.match(/TO service_role;/g)).toHaveLength(2);
    expect(route).toContain("applyAdminUserPatch");
    expect(route).not.toContain("logAudit");
    expect(route).not.toContain("logDiff");
    expect(route).not.toContain('.from("users").update');
  });

  it("constrains the admin form to safe role families and lifecycle paths", () => {
    expect(editForm).toContain("allowedRoles");
    expect(editForm).toContain("INTERNAL_ROLES.includes");
    expect(editForm).toContain("dedicated tenant");
    expect(editForm).toContain("isInactive");
    expect(editForm).toContain("dedicated reviewed workflow");
    expect(editForm).toContain('htmlFor="admin-user-role"');
    expect(editForm).toContain('htmlFor="admin-user-status"');
    expect(detailPage).not.toContain(">\n              User details\n");
  });
});
