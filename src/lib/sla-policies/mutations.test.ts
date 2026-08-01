import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  slaPolicyCreateRequestSchema,
  slaPolicyPatchRequestSchema,
} from "./contracts";
import {
  AdminSLAPolicyMutationError,
  applyAdminSLAPolicyPatch,
  createAdminSLAPolicyAtomic,
  deleteAdminSLAPolicyAtomic,
} from "./mutations";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const POLICY_ID = "22222222-2222-4222-8222-222222222222";
const POLICY = {
  id: POLICY_ID,
  created_at: "2026-07-31T00:00:00.000Z",
  updated_at: "2026-07-31T00:00:00.000Z",
  name: "Default SLA",
  customer_id: null,
  is_default: true,
  p1_response_minutes: 15,
  p1_resolution_minutes: 240,
  p2_response_minutes: 60,
  p2_resolution_minutes: 480,
  p3_response_minutes: 240,
  p3_resolution_minutes: 1440,
  p4_response_minutes: 1440,
  p4_resolution_minutes: 4320,
};
const CREATE_INPUT = {
  name: POLICY.name,
  customer_id: POLICY.customer_id,
  p1_response_minutes: POLICY.p1_response_minutes,
  p1_resolution_minutes: POLICY.p1_resolution_minutes,
  p2_response_minutes: POLICY.p2_response_minutes,
  p2_resolution_minutes: POLICY.p2_resolution_minutes,
  p3_response_minutes: POLICY.p3_response_minutes,
  p3_resolution_minutes: POLICY.p3_resolution_minutes,
  p4_response_minutes: POLICY.p4_response_minutes,
  p4_resolution_minutes: POLICY.p4_resolution_minutes,
};

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

describe("SLA policy request contracts", () => {
  it("accepts a complete ordered create request", () => {
    expect(
      slaPolicyCreateRequestSchema.safeParse({
        name: " Default SLA ",
        customer_id: null,
        p1_response_minutes: 15,
        p1_resolution_minutes: 240,
        p2_response_minutes: 60,
        p2_resolution_minutes: 480,
        p3_response_minutes: 240,
        p3_resolution_minutes: 1440,
        p4_response_minutes: 1440,
        p4_resolution_minutes: 4320,
      }).success
    ).toBe(true);
  });

  it("rejects unknown scope flags and response-after-resolution targets", () => {
    const base = {
      name: "Default SLA",
      customer_id: null,
      p1_response_minutes: 15,
      p1_resolution_minutes: 240,
      p2_response_minutes: 60,
      p2_resolution_minutes: 480,
      p3_response_minutes: 240,
      p3_resolution_minutes: 1440,
      p4_response_minutes: 1440,
      p4_resolution_minutes: 4320,
    };

    expect(
      slaPolicyCreateRequestSchema.safeParse({ ...base, is_default: true })
        .success
    ).toBe(false);
    expect(
      slaPolicyCreateRequestSchema.safeParse({
        ...base,
        p1_response_minutes: 241,
      }).success
    ).toBe(false);
  });

  it("rejects empty patches and immutable scope fields", () => {
    expect(slaPolicyPatchRequestSchema.safeParse({}).success).toBe(false);
    expect(
      slaPolicyPatchRequestSchema.safeParse({ customer_id: POLICY_ID }).success
    ).toBe(false);
    expect(
      slaPolicyPatchRequestSchema.safeParse({ is_default: false }).success
    ).toBe(false);
  });
});

describe("atomic SLA policy mutation wrappers", () => {
  it("sends create, patch, and delete through their command RPCs", async () => {
    const { client, rpc } = clientWithRpc({ data: POLICY, error: null });

    await createAdminSLAPolicyAtomic({
      supabase: client,
      actorId: ACTOR_ID,
      input: CREATE_INPUT,
    });
    await applyAdminSLAPolicyPatch({
      supabase: client,
      actorId: ACTOR_ID,
      policyId: POLICY_ID,
      patch: { name: "Updated SLA" },
    });
    await deleteAdminSLAPolicyAtomic({
      supabase: client,
      actorId: ACTOR_ID,
      policyId: POLICY_ID,
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "create_admin_sla_policy_atomic",
      "apply_admin_sla_policy_patch",
      "delete_admin_sla_policy_atomic",
    ]);
  });

  it("preserves SQLSTATE without exposing provider messages", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { code: "55000" },
    });

    await expect(
      deleteAdminSLAPolicyAtomic({
        supabase: client,
        actorId: ACTOR_ID,
        policyId: POLICY_ID,
      })
    ).rejects.toMatchObject({
      name: "AdminSLAPolicyMutationError",
      message: "Atomic SLA policy deletion failed",
      code: "55000",
    } satisfies Partial<AdminSLAPolicyMutationError>);
  });

  it("rejects incomplete command results", async () => {
    const { client } = clientWithRpc({
      data: { ...POLICY, p4_resolution_minutes: "4320" },
      error: null,
    });

    await expect(
      applyAdminSLAPolicyPatch({
        supabase: client,
        actorId: ACTOR_ID,
        policyId: POLICY_ID,
        patch: { name: "Updated SLA" },
      })
    ).rejects.toThrow(
      "Atomic SLA policy update returned an invalid result"
    );
  });
});

describe("migration 041 SLA policy integrity", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/041_atomic_admin_sla_policy_commands.sql"
    ),
    "utf8"
  );
  const createRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/admin/sla-policies/route.ts"),
    "utf8"
  );
  const itemRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/admin/sla-policies/[id]/route.ts"),
    "utf8"
  );
  const form = readFileSync(
    resolve(
      process.cwd(),
      "src/app/(auth)/admin/sla-policies/sla-policy-form.tsx"
    ),
    "utf8"
  );

  it("enforces scope shape and response-before-resolution in PostgreSQL", () => {
    expect(migration).toContain("CONSTRAINT sla_policies_scope_shape");
    expect(migration).toContain("CONSTRAINT sla_policies_target_order");
    expect(migration).toContain(
      "v_is_default IS DISTINCT FROM (v_customer_id IS NULL)"
    );
    expect(migration).toContain("v_p1_response > v_p1_resolution");
  });

  it("serializes all three commands and commits audit in their transaction", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration.match(/pg_advisory_xact_lock/g)).toHaveLength(3);
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.create_admin_sla_policy_atomic"
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.apply_admin_sla_policy_patch"
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.delete_admin_sla_policy_atomic"
    );
    expect(migration.match(/INSERT INTO public\.audit_logs/g)).toHaveLength(3);
  });

  it("protects default/referenced deletion and service-role execution", () => {
    expect(migration).toContain("Default SLA policy cannot be deleted");
    expect(migration).toContain("Referenced SLA policy cannot be deleted");
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(3);
    expect(migration.match(/FROM PUBLIC, anon, authenticated;/g)).toHaveLength(
      3
    );
    expect(migration.match(/TO service_role;/g)).toHaveLength(3);
  });

  it("removes direct route writes and best-effort audit", () => {
    expect(createRoute).toContain("createAdminSLAPolicyAtomic");
    expect(itemRoute).toContain("applyAdminSLAPolicyPatch");
    expect(itemRoute).toContain("deleteAdminSLAPolicyAtomic");
    expect(`${createRoute}${itemRoute}`).not.toContain("logAudit");
    expect(`${createRoute}${itemRoute}`).not.toContain("logDiff");
    expect(`${createRoute}${itemRoute}`).not.toMatch(
      /\.(insert|update|delete)\(/
    );
  });

  it("keeps the form responsive, labeled, and scope-derived", () => {
    expect(form).toContain('htmlFor="sla-policy-name"');
    expect(form).toContain('id="sla-policy-customer"');
    expect(form).toContain("grid-cols-1");
    expect(form).toContain("sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)]");
    expect(form).toContain('mode === "create"');
    expect(form).not.toContain('id="is_default"');
  });
});
