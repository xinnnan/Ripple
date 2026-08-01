import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AdminCustomerMutationError,
  applyAdminCustomerPatch,
  createAdminCustomerAtomic,
} from "./mutations";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = {
  id: CUSTOMER_ID,
  name: "Acme Logistics",
  domain: "acme.example",
  status: "active" as const,
  created_at: "2026-07-31T00:00:00.000Z",
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

describe("admin customer mutation contract", () => {
  it("sends customer creation through one atomic command", async () => {
    const { client, rpc } = clientWithRpc({ data: CUSTOMER, error: null });
    const input = {
      name: "Acme Logistics",
      domain: "acme.example",
      status: "active" as const,
    };

    await expect(
      createAdminCustomerAtomic({
        supabase: client,
        actorId: ACTOR_ID,
        input,
      })
    ).resolves.toEqual(CUSTOMER);

    expect(rpc).toHaveBeenCalledWith("create_admin_customer_atomic", {
      p_actor_id: ACTOR_ID,
      p_input: input,
    });
  });

  it("sends mutable customer fields through one atomic patch command", async () => {
    const updated = { ...CUSTOMER, status: "trial" as const };
    const { client, rpc } = clientWithRpc({ data: updated, error: null });
    const patch = { name: "Acme Distribution", status: "trial" as const };

    await expect(
      applyAdminCustomerPatch({
        supabase: client,
        actorId: ACTOR_ID,
        customerId: CUSTOMER_ID,
        patch,
      })
    ).resolves.toEqual(updated);

    expect(rpc).toHaveBeenCalledWith("apply_admin_customer_patch", {
      p_actor_id: ACTOR_ID,
      p_customer_id: CUSTOMER_ID,
      p_patch: patch,
    });
  });

  it("preserves command codes without exposing database messages", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { code: "55000" },
    });

    const operation = applyAdminCustomerPatch({
      supabase: client,
      actorId: ACTOR_ID,
      customerId: CUSTOMER_ID,
      patch: { name: "Blocked" },
    });

    await expect(operation).rejects.toMatchObject({
      name: "AdminCustomerMutationError",
      message: "Atomic admin customer update failed",
      code: "55000",
    } satisfies Partial<AdminCustomerMutationError>);
  });

  it("rejects an invalid command result", async () => {
    const { client } = clientWithRpc({ data: CUSTOMER_ID, error: null });

    await expect(
      createAdminCustomerAtomic({
        supabase: client,
        actorId: ACTOR_ID,
        input: { name: "Acme", status: "active" },
      })
    ).rejects.toMatchObject({
      name: "AdminCustomerMutationError",
      message: "Atomic admin customer creation returned an invalid result",
    });
  });
});

describe("migration 040 admin customer integrity", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/040_atomic_admin_customer_commands.sql"
    ),
    "utf8"
  );
  const createRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/customers/route.ts"),
    "utf8"
  );
  const updateRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/customers/[id]/route.ts"),
    "utf8"
  );
  const createForm = readFileSync(
    resolve(
      process.cwd(),
      "src/app/(auth)/admin/customers/create-customer-form.tsx"
    ),
    "utf8"
  );
  const editForm = readFileSync(
    resolve(
      process.cwd(),
      "src/app/(auth)/admin/customers/[id]/edit-customer-form.tsx"
    ),
    "utf8"
  );

  it("commits customer changes and audit evidence together", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.create_admin_customer_atomic"
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.apply_admin_customer_patch"
    );
    expect(migration).toContain("INSERT INTO public.customers");
    expect(migration).toContain("UPDATE public.customers AS customer");
    expect(migration.match(/INSERT INTO public\.audit_logs/g)).toHaveLength(4);
  });

  it("locks updates and keeps archive as the only inactive transition", () => {
    expect(migration).toContain("FOR UPDATE OF customer");
    expect(migration).toContain("v_before.status = 'inactive'");
    expect(migration).toContain("v_status = 'inactive'");
    expect(migration).toContain("USING ERRCODE = '55000'");
    expect(migration).toContain("v_status NOT IN ('active', 'trial')");
    expect(migration).toContain("v_before.name IS DISTINCT FROM v_after.name");
  });

  it("restricts both commands to service role with empty search paths", () => {
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(2);
    expect(migration.match(/FROM PUBLIC, anon, authenticated;/g)).toHaveLength(
      2
    );
    expect(migration.match(/TO service_role;/g)).toHaveLength(2);
  });

  it("removes split route writes and best-effort audit", () => {
    expect(createRoute).toContain("createAdminCustomerAtomic");
    expect(updateRoute).toContain("applyAdminCustomerPatch");
    expect(createRoute).not.toContain("logAudit");
    expect(updateRoute).not.toContain("logDiff");
    expect(createRoute).not.toContain(".insert(");
    expect(updateRoute).not.toContain(".update(");
    expect(updateRoute).toContain("ARCHIVE_REQUIRED");
  });

  it("keeps customer forms accessible, responsive, and lifecycle-aware", () => {
    expect(createForm).toContain('htmlFor="customer-create-name"');
    expect(createForm).toContain('id="customer-create-domain"');
    expect(createForm).toContain("grid-cols-1");
    expect(createForm).toContain("maxLength={253}");
    expect(editForm).toContain('htmlFor="customer-edit-status"');
    expect(editForm).toContain("disabled={isArchived}");
    expect(editForm).toContain("Archived customers are read-only");
    expect(editForm).toContain("md:grid-cols-2");
  });
});
