import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AdminSiteMutationError,
  applyAdminSitePatch,
  createAdminSiteAtomic,
} from "./mutations";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const SITE_ID = "33333333-3333-4333-8333-333333333333";

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

describe("admin site mutation contract", () => {
  it("sends site creation through one atomic command", async () => {
    const { client, rpc } = clientWithRpc({ data: SITE_ID, error: null });
    const input = {
      customer_id: CUSTOMER_ID,
      site_name: "Indianapolis DC",
      site_code: "INDY-01",
      timezone: "America/Indiana/Indianapolis",
      address: null,
      status: "active" as const,
      project_status: "pre_signoff" as const,
    };

    await expect(
      createAdminSiteAtomic({
        supabase: client,
        actorId: ACTOR_ID,
        input,
      })
    ).resolves.toBe(SITE_ID);

    expect(rpc).toHaveBeenCalledWith("create_admin_site_atomic", {
      p_actor_id: ACTOR_ID,
      p_input: input,
    });
  });

  it("sends mutable site fields through one atomic patch command", async () => {
    const { client, rpc } = clientWithRpc({ data: SITE_ID, error: null });
    const patch = {
      site_name: "Indianapolis Distribution Center",
      status: "commissioning" as const,
    };

    await expect(
      applyAdminSitePatch({
        supabase: client,
        actorId: ACTOR_ID,
        siteId: SITE_ID,
        patch,
      })
    ).resolves.toBe(SITE_ID);

    expect(rpc).toHaveBeenCalledWith("apply_admin_site_patch", {
      p_actor_id: ACTOR_ID,
      p_site_id: SITE_ID,
      p_patch: patch,
    });
  });

  it("preserves command codes without exposing database messages", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { code: "55000" },
    });

    const operation = applyAdminSitePatch({
      supabase: client,
      actorId: ACTOR_ID,
      siteId: SITE_ID,
      patch: { site_name: "Blocked" },
    });

    await expect(operation).rejects.toMatchObject({
      name: "AdminSiteMutationError",
      message: "Atomic admin site update failed",
      code: "55000",
    } satisfies Partial<AdminSiteMutationError>);
  });
});

describe("migration 036 admin site integrity", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/036_atomic_admin_site_commands.sql"
    ),
    "utf8"
  );
  const createRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/sites/route.ts"),
    "utf8"
  );
  const updateRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/admin/sites/[id]/route.ts"),
    "utf8"
  );
  const editForm = readFileSync(
    resolve(
      process.cwd(),
      "src/app/(auth)/admin/sites/[id]/edit-site-form.tsx"
    ),
    "utf8"
  );
  const detailPage = readFileSync(
    resolve(
      process.cwd(),
      "src/app/(auth)/admin/sites/[id]/page.tsx"
    ),
    "utf8"
  );

  it("commits site creation/update and audit evidence together", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.create_admin_site_atomic"
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.apply_admin_site_patch"
    );
    expect(migration).toContain("INSERT INTO public.sites");
    expect(migration).toContain("UPDATE public.sites AS site");
    expect(migration.match(/INSERT INTO public\.audit_logs/g)).toHaveLength(2);
  });

  it("makes tenant ownership immutable and enforces lifecycle/configuration", () => {
    expect(migration).toContain("p_patch ? 'customer_id'");
    expect(migration).toContain(
      "Site customer ownership is immutable after creation"
    );
    expect(migration).toContain("FOR UPDATE OF site");
    expect(migration).toContain("customer.status IN ('active', 'trial')");
    expect(migration).toContain(
      "v_before.status NOT IN ('active', 'commissioning')"
    );
    expect(migration).toContain("pg_catalog.pg_timezone_names");
    expect(migration).toContain("owner.role IN ('admin', 'engineer')");
  });

  it("restricts both commands to the service role", () => {
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(2);
    expect(migration).toMatch(
      /create_admin_site_atomic[\s\S]+FROM PUBLIC, anon, authenticated/
    );
    expect(migration).toMatch(
      /apply_admin_site_patch[\s\S]+FROM PUBLIC, anon, authenticated/
    );
    expect(migration.match(/TO service_role;/g)).toHaveLength(2);
  });

  it("removes direct route writes and customer reassignment UI", () => {
    expect(createRoute).toContain("createAdminSiteAtomic");
    expect(createRoute).not.toContain("logAudit");
    expect(createRoute).not.toContain(".insert(");
    expect(updateRoute).toContain("applyAdminSitePatch");
    expect(updateRoute).not.toContain("logDiff");
    expect(updateRoute).not.toContain(".update(");
    expect(updateRoute).not.toContain("customer_id:");
    expect(editForm).not.toContain("setCustomerId");
    expect(editForm).not.toContain("customer_id: customerId");
    expect(editForm).toContain("Customer ownership is fixed");
    expect(detailPage).toContain("canEditSite");
  });
});
