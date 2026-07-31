import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  UserProvisioningError,
  provisionAdminUser,
  provisionTeamUser,
} from "./provisioning";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
const SITE_ID = "44444444-4444-4444-8444-444444444444";

function provisioningClient(options?: {
  authError?: { code?: string } | null;
  rpcResult?: { data: unknown; error: null | { code?: string } };
  rpcThrows?: boolean;
  profile?: {
    role: string;
    status: string;
    customer_id: string | null;
  } | null;
  profileError?: boolean;
  cleanupProfileError?: boolean;
  cleanupAuthError?: boolean;
}) {
  const createUser = vi.fn().mockResolvedValue(
    options?.authError
      ? { data: { user: null }, error: options.authError }
      : {
          data: { user: { id: USER_ID, email: "created@example.com" } },
          error: null,
        }
  );
  const deleteUser = vi.fn().mockResolvedValue({
    data: null,
    error: options?.cleanupAuthError ? { code: "cleanup_failed" } : null,
  });
  const rpc = options?.rpcThrows
    ? vi.fn().mockRejectedValue(new Error("transport failed"))
    : vi.fn().mockResolvedValue(
        options?.rpcResult ?? { data: USER_ID, error: null }
      );
  const maybeSingle = vi.fn().mockResolvedValue({
    data: options?.profile ?? null,
    error: options?.profileError ? { code: "read_failed" } : null,
  });
  const deleteEq = vi.fn().mockResolvedValue({
    error: options?.cleanupProfileError ? { code: "cleanup_failed" } : null,
  });
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle })),
    })),
    delete: vi.fn(() => ({ eq: deleteEq })),
  }));

  return {
    client: {
      auth: { admin: { createUser, deleteUser } },
      rpc,
      from,
    } as unknown as SupabaseClient,
    createUser,
    deleteUser,
    rpc,
    from,
    deleteEq,
  };
}

const base = {
  actorId: ACTOR_ID,
  email: "created@example.com",
  password: "a-secure-password-123",
  fullName: "Created User",
  phone: "+1 555 0100",
};

describe("secure user provisioning wrapper", () => {
  it("creates a safe profile before atomically finalizing an internal user", async () => {
    const { client, createUser, rpc, deleteUser } = provisioningClient();

    await expect(
      provisionAdminUser({ ...base, supabase: client, role: "engineer" })
    ).resolves.toEqual({ id: USER_ID, email: "created@example.com" });

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email_confirm: true,
        user_metadata: {
          full_name: "Created User",
          role: "customer",
        },
      })
    );
    expect(rpc).toHaveBeenCalledWith("finalize_admin_user_creation", {
      p_actor_id: ACTOR_ID,
      p_target_user_id: USER_ID,
      p_full_name: "Created User",
      p_role: "engineer",
      p_phone: "+1 555 0100",
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("routes customer creation through the tenant/site finalizer", async () => {
    const { client, rpc } = provisioningClient();

    await provisionTeamUser({
      ...base,
      supabase: client,
      customerId: CUSTOMER_ID,
      siteIds: [SITE_ID],
    });

    expect(rpc).toHaveBeenCalledWith("finalize_team_user_creation", {
      p_actor_id: ACTOR_ID,
      p_target_user_id: USER_ID,
      p_full_name: "Created User",
      p_phone: "+1 555 0100",
      p_site_ids: [SITE_ID],
    });
  });

  it("compensates a definitely provisional identity after command rejection", async () => {
    const { client, deleteUser, deleteEq } = provisioningClient({
      rpcResult: { data: null, error: { code: "55000" } },
      profile: { role: "customer", status: "active", customer_id: null },
    });

    const operation = provisionAdminUser({
      ...base,
      supabase: client,
      role: "admin",
    });

    await expect(operation).rejects.toMatchObject({
      name: "UserProvisioningError",
      phase: "finalize",
      code: "55000",
      reconciliationRequired: false,
    } satisfies Partial<UserProvisioningError>);
    expect(deleteEq).toHaveBeenCalledWith("id", USER_ID);
    expect(deleteUser).toHaveBeenCalledWith(USER_ID);
  });

  it("treats a committed profile as success after an ambiguous response", async () => {
    const { client, deleteUser } = provisioningClient({
      rpcThrows: true,
      profile: { role: "engineer", status: "active", customer_id: null },
    });

    await expect(
      provisionAdminUser({ ...base, supabase: client, role: "engineer" })
    ).resolves.toEqual({ id: USER_ID, email: "created@example.com" });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("does not destructively compensate an unknown finalization state", async () => {
    const { client, deleteUser } = provisioningClient({
      rpcThrows: true,
      profileError: true,
    });

    const operation = provisionTeamUser({
      ...base,
      supabase: client,
      customerId: CUSTOMER_ID,
      siteIds: [],
    });

    await expect(operation).rejects.toMatchObject({
      phase: "reconcile",
      reconciliationRequired: true,
    } satisfies Partial<UserProvisioningError>);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("does not call a finalizer when Auth identity creation fails", async () => {
    const { client, rpc } = provisioningClient({
      authError: { code: "email_exists" },
    });

    await expect(
      provisionAdminUser({ ...base, supabase: client, role: "admin" })
    ).rejects.toMatchObject({
      phase: "auth",
      code: "email_exists",
    } satisfies Partial<UserProvisioningError>);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("migration 039 provisioning integrity", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/039_secure_user_provisioning.sql"),
    "utf8"
  );
  const adminRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/admin/users/route.ts"),
    "utf8"
  );
  const teamRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/team/route.ts"),
    "utf8"
  );
  const adminForm = readFileSync(
    resolve(
      process.cwd(),
      "src/app/(auth)/admin/users/create-user-form.tsx"
    ),
    "utf8"
  );

  it("rejects privileged auth metadata and mirrors only the safe role", () => {
    expect(migration).toContain("v_requested_role <> 'customer'");
    expect(migration).toContain("USING ERRCODE = '42501'");
    expect(migration).toContain("NEW.email_confirmed_at IS NULL");
    expect(migration).toMatch(/'customer',\s+v_status/);
    expect(migration).not.toMatch(
      /COALESCE\(NEW\.raw_user_meta_data->>'role'/
    );
  });

  it("finalizes internal and tenant users below the HTTP routes", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.finalize_admin_user_creation"
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.finalize_team_user_creation"
    );
    expect(migration.match(/pg_catalog\.pg_advisory_xact_lock/g)).toHaveLength(
      2
    );
    expect(migration).toContain("p_role NOT IN ('admin', 'engineer')");
    expect(migration).toContain("actor.role = 'customer_manager'");
    expect(migration).toContain("site.customer_id = v_actor_customer_id");
    expect(migration).toContain("INSERT INTO public.site_members");
    expect(migration.match(/INSERT INTO public\.audit_logs/g)).toHaveLength(2);
  });

  it("keeps both finalizers service-role-only with empty search paths", () => {
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(3);
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(3);
    expect(migration.match(/FROM PUBLIC, anon, authenticated;/g)).toHaveLength(
      3
    );
    expect(migration.match(/TO service_role;/g)).toHaveLength(2);
  });

  it("removes split business writes and best-effort audit from both routes", () => {
    expect(adminRoute).toContain("provisionAdminUser");
    expect(teamRoute).toContain("provisionTeamUser");
    expect(adminRoute).not.toContain("logAudit");
    expect(teamRoute).not.toContain("logAudit");
    expect(adminRoute).not.toContain('.from("users").update');
    expect(teamRoute).not.toContain('.from("site_members").upsert');
  });

  it("constrains admin creation to internal roles and stronger passwords", () => {
    expect(adminRoute).toContain('z.enum(["admin", "engineer"])');
    expect(adminRoute).toContain("password: z.string().min(12).max(128)");
    expect(adminForm).toContain("INTERNAL_ROLE_OPTIONS");
    expect(adminForm).toContain("tenant-bound provisioning workflow");
    expect(adminForm).toContain("minLength={12}");
    expect(adminForm).toContain('htmlFor="admin-create-user-email"');
  });
});
