import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sparePartCreateRequestSchema,
  sparePartPatchRequestSchema,
} from "./admin-contracts";
import {
  AdminSparePartMutationError,
  applyAdminSparePartPatch,
  createAdminSparePartAtomic,
} from "./admin-mutations";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const PART_ID = "22222222-2222-4222-8222-222222222222";
const CREATE_INPUT = {
  part_number: "SEN-001",
  part_name: "LiDAR Sensor",
  description: null,
  category: "sensor" as const,
  unit: "piece" as const,
  unit_price: 1200,
  compatible_models: ["AMR-X1"],
  image_url: null,
};
const PART = {
  id: PART_ID,
  ...CREATE_INPUT,
  is_active: true,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
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

describe("admin spare-part request contracts", () => {
  it("normalizes a bounded create request and supplies nullable defaults", () => {
    const parsed = sparePartCreateRequestSchema.parse({
      part_number: " SEN-001 ",
      part_name: " LiDAR Sensor ",
    });

    expect(parsed).toEqual({
      part_number: "SEN-001",
      part_name: "LiDAR Sensor",
      description: null,
      category: "other",
      unit: "piece",
      unit_price: null,
      compatible_models: null,
      image_url: null,
    });
  });

  it("rejects unknown lifecycle fields, negative price, and invalid models", () => {
    expect(
      sparePartCreateRequestSchema.safeParse({
        ...CREATE_INPUT,
        is_active: false,
      }).success
    ).toBe(false);
    expect(
      sparePartCreateRequestSchema.safeParse({
        ...CREATE_INPUT,
        unit_price: -1,
      }).success
    ).toBe(false);
    expect(
      sparePartCreateRequestSchema.safeParse({
        ...CREATE_INPUT,
        compatible_models: [""],
      }).success
    ).toBe(false);
  });

  it("rejects empty and unknown patches", () => {
    expect(sparePartPatchRequestSchema.safeParse({}).success).toBe(false);
    expect(
      sparePartPatchRequestSchema.safeParse({ rogue: true }).success
    ).toBe(false);
  });
});

describe("atomic admin spare-part mutation wrappers", () => {
  it("uses the create and patch command RPCs", async () => {
    const { client, rpc } = clientWithRpc({ data: PART, error: null });

    await createAdminSparePartAtomic({
      supabase: client,
      actorId: ACTOR_ID,
      input: CREATE_INPUT,
    });
    await applyAdminSparePartPatch({
      supabase: client,
      actorId: ACTOR_ID,
      sparePartId: PART_ID,
      patch: { part_name: "Updated Sensor" },
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "create_admin_spare_part_atomic",
      "apply_admin_spare_part_patch",
    ]);
  });

  it("preserves SQLSTATE without exposing provider messages", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { code: "23505" },
    });

    await expect(
      createAdminSparePartAtomic({
        supabase: client,
        actorId: ACTOR_ID,
        input: CREATE_INPUT,
      })
    ).rejects.toMatchObject({
      name: "AdminSparePartMutationError",
      message: "Atomic spare-part creation failed",
      code: "23505",
    } satisfies Partial<AdminSparePartMutationError>);
  });

  it("rejects incomplete command results", async () => {
    const { client } = clientWithRpc({
      data: { ...PART, unit_price: "1200.00" },
      error: null,
    });

    await expect(
      applyAdminSparePartPatch({
        supabase: client,
        actorId: ACTOR_ID,
        sparePartId: PART_ID,
        patch: { part_name: "Updated Sensor" },
      })
    ).rejects.toThrow(
      "Atomic spare-part update returned an invalid result"
    );
  });
});

describe("migration 042 spare-part catalog integrity", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/042_atomic_admin_spare_part_commands.sql"
    ),
    "utf8"
  );
  const createRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/admin/spare-parts/route.ts"),
    "utf8"
  );
  const itemRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/admin/spare-parts/[id]/route.ts"),
    "utf8"
  );
  const form = readFileSync(
    resolve(
      process.cwd(),
      "src/app/(auth)/admin/spare-parts/spare-part-form.tsx"
    ),
    "utf8"
  );
  const catalogPage = readFileSync(
    resolve(
      process.cwd(),
      "src/app/(auth)/admin/spare-parts/page.tsx"
    ),
    "utf8"
  );

  it("adds normalized shape, price, and case-folded identity invariants", () => {
    expect(migration).toContain("ALTER COLUMN category SET NOT NULL");
    expect(migration).toContain("spare_parts_part_number_shape");
    expect(migration).toContain("spare_parts_part_name_shape");
    expect(migration).toContain("spare_parts_description_length");
    expect(migration).toContain("spare_parts_compatible_models_count");
    expect(migration).toContain("spare_parts_image_url_length");
    expect(migration).toContain("spare_parts_unit_price_nonnegative");
    expect(migration).toContain("spare_parts_part_number_casefold_unique");
    expect(migration).toContain(
      "pg_catalog.lower(pg_catalog.btrim(part_number))"
    );
  });

  it("serializes both commands and commits audit in their transactions", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.create_admin_spare_part_atomic"
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.apply_admin_spare_part_patch"
    );
    expect(migration.match(/INSERT INTO public\.audit_logs/g)).toHaveLength(2);
  });

  it("uses safe expressions and service-role-only execution", () => {
    expect(migration).not.toContain("pg_catalog.coalesce");
    expect(migration).not.toContain("pg_catalog.nullif");
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(2);
    expect(migration.match(/FROM PUBLIC, anon, authenticated;/g)).toHaveLength(
      2
    );
    expect(migration.match(/TO service_role;/g)).toHaveLength(2);
  });

  it("removes direct route writes and best-effort audit", () => {
    expect(createRoute).toContain("createAdminSparePartAtomic");
    expect(itemRoute).toContain("applyAdminSparePartPatch");
    expect(`${createRoute}${itemRoute}`).not.toContain("logAudit");
    expect(`${createRoute}${itemRoute}`).not.toContain("logDiff");
    expect(`${createRoute}${itemRoute}`).not.toMatch(
      /\.(insert|update|delete)\(/
    );
  });

  it("uses one responsive, labeled create/edit form", () => {
    expect(form).toContain('htmlFor="spare-part-number"');
    expect(form).toContain('htmlFor="spare-part-image-url"');
    expect(form).toContain('role="alert"');
    expect(form).toContain("grid-cols-1");
    expect(form).toContain("sm:grid-cols-2");
    expect(form).toContain('mode === "edit"');
  });

  it("distinguishes a zero price from an unavailable price", () => {
    expect(catalogPage).toContain("part.unit_price != null");
  });
});
