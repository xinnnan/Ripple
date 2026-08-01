import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  inventoryPatchRequestSchema,
  inventoryUpsertRequestSchema,
} from "./inventory-contracts";
import {
  AdminInventoryMutationError,
  applyAdminInventoryPatch,
  upsertAdminInventoryAtomic,
} from "./inventory-mutations";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const INVENTORY_ID = "22222222-2222-4222-8222-222222222222";
const PART_ID = "33333333-3333-4333-8333-333333333333";
const SITE_ID = "44444444-4444-4444-8444-444444444444";
const INPUT = {
  spare_part_id: PART_ID,
  site_id: SITE_ID,
  quantity: 8,
  min_quantity: 2,
  max_quantity: 20,
  location: "Cage A · Bin 12",
};
const INVENTORY = {
  id: INVENTORY_ID,
  ...INPUT,
  last_restocked_at: "2026-08-01T12:00:00.000Z",
  created_at: "2026-08-01T12:00:00.000Z",
  updated_at: "2026-08-01T12:00:00.000Z",
  spare_part: {
    id: PART_ID,
    part_number: "SEN-001",
    part_name: "LiDAR Sensor",
    category: "sensor",
  },
  site: {
    id: SITE_ID,
    site_name: "Indianapolis DC",
    site_code: "INDY-01",
  },
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

describe("admin inventory request contracts", () => {
  it("normalizes an upsert and supplies safe stock defaults", () => {
    expect(
      inventoryUpsertRequestSchema.parse({
        spare_part_id: PART_ID,
        site_id: SITE_ID,
        location: "  Bin 12  ",
      })
    ).toEqual({
      spare_part_id: PART_ID,
      site_id: SITE_ID,
      quantity: 0,
      min_quantity: 0,
      max_quantity: null,
      location: "Bin 12",
    });
  });

  it("rejects negative, fractional, inverted, and over-maximum stock", () => {
    for (const candidate of [
      { ...INPUT, quantity: -1 },
      { ...INPUT, quantity: 1.5 },
      { ...INPUT, min_quantity: 21 },
      { ...INPUT, quantity: 21 },
    ]) {
      expect(inventoryUpsertRequestSchema.safeParse(candidate).success).toBe(
        false
      );
    }
  });

  it("rejects empty and unknown patches while normalizing blank location", () => {
    expect(inventoryPatchRequestSchema.safeParse({}).success).toBe(false);
    expect(
      inventoryPatchRequestSchema.safeParse({ rogue: true }).success
    ).toBe(false);
    expect(inventoryPatchRequestSchema.parse({ location: "  " })).toEqual({
      location: null,
    });
  });
});

describe("atomic admin inventory mutation wrappers", () => {
  it("uses the upsert and patch command RPCs", async () => {
    const { client, rpc } = clientWithRpc({ data: INVENTORY, error: null });

    await upsertAdminInventoryAtomic({
      supabase: client,
      actorId: ACTOR_ID,
      input: INPUT,
    });
    await applyAdminInventoryPatch({
      supabase: client,
      actorId: ACTOR_ID,
      inventoryId: INVENTORY_ID,
      patch: { quantity: 9 },
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "upsert_admin_spare_part_inventory_atomic",
      "apply_admin_spare_part_inventory_patch",
    ]);
  });

  it("preserves SQLSTATE without exposing provider messages", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { code: "55000" },
    });

    await expect(
      upsertAdminInventoryAtomic({
        supabase: client,
        actorId: ACTOR_ID,
        input: INPUT,
      })
    ).rejects.toMatchObject({
      name: "AdminInventoryMutationError",
      message: "Atomic inventory upsert failed",
      code: "55000",
    } satisfies Partial<AdminInventoryMutationError>);
  });

  it("rejects incomplete or incorrectly typed command results", async () => {
    const { client } = clientWithRpc({
      data: { ...INVENTORY, quantity: "8" },
      error: null,
    });

    await expect(
      applyAdminInventoryPatch({
        supabase: client,
        actorId: ACTOR_ID,
        inventoryId: INVENTORY_ID,
        patch: { quantity: 9 },
      })
    ).rejects.toThrow("Atomic inventory update returned an invalid result");
  });
});

describe("migration 043 inventory integrity", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/043_atomic_admin_spare_part_inventory_commands.sql"
    ),
    "utf8"
  );
  const collectionRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/admin/inventory/route.ts"),
    "utf8"
  );
  const itemRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/admin/inventory/[id]/route.ts"),
    "utf8"
  );
  const inventoryUi = readFileSync(
    resolve(
      process.cwd(),
      "src/app/(auth)/admin/inventory/inventory-client.tsx"
    ),
    "utf8"
  );
  const appShell = readFileSync(
    resolve(process.cwd(), "src/components/app-shell.tsx"),
    "utf8"
  );

  it("adds nonnegative, ordered, capped, and normalized location invariants", () => {
    for (const constraint of [
      "spare_part_inventory_quantity_nonnegative",
      "spare_part_inventory_min_quantity_nonnegative",
      "spare_part_inventory_max_quantity_nonnegative",
      "spare_part_inventory_bounds_ordered",
      "spare_part_inventory_quantity_within_maximum",
      "spare_part_inventory_location_shape",
    ]) {
      expect(migration).toContain(constraint);
    }
  });

  it("serializes both commands and commits exact audit evidence", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.upsert_admin_spare_part_inventory_atomic"
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.apply_admin_spare_part_inventory_patch"
    );
    expect(migration.match(/INSERT INTO public\.audit_logs/g)).toHaveLength(3);
    expect(migration).toContain("'spare_part_inventory'");
  });

  it("enforces parent lifecycle and server-derived restock semantics", () => {
    expect(migration.match(/part\.is_active = true/g)).toHaveLength(2);
    expect(migration.match(/site\.status IN \('active', 'commissioning'\)/g)).toHaveLength(2);
    expect(migration.match(/customer\.status IN \('active', 'trial'\)/g)).toHaveLength(2);
    expect(
      migration.match(/v_restocked := v_quantity > v_before\.quantity/g)
    ).toHaveLength(2);
    expect(migration).toContain(
      "CASE WHEN v_quantity > 0 THEN pg_catalog.now() ELSE NULL END"
    );
  });

  it("keeps no-ops unchanged and restricts execution to the service role", () => {
    expect(migration.match(/IF NOT v_has_changes THEN/g)).toHaveLength(2);
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(2);
    expect(migration.match(/FROM PUBLIC, anon, authenticated;/g)).toHaveLength(
      2
    );
    expect(migration.match(/TO service_role;/g)).toHaveLength(2);
    expect(migration).not.toContain("pg_catalog.coalesce");
    expect(migration).not.toContain("pg_catalog.nullif");
  });

  it("removes direct route writes and best-effort audit", () => {
    expect(collectionRoute).toContain("upsertAdminInventoryAtomic");
    expect(itemRoute).toContain("applyAdminInventoryPatch");
    expect(`${collectionRoute}${itemRoute}`).not.toContain("logAudit");
    expect(`${collectionRoute}${itemRoute}`).not.toMatch(
      /\.(insert|upsert|update|delete)\(/
    );
  });

  it("adds a responsive, labeled inventory workspace", () => {
    expect(appShell).toContain('href: "/admin/inventory"');
    expect(inventoryUi).toContain("htmlFor={id}");
    expect(inventoryUi).toContain('htmlFor="inventory-location"');
    expect(inventoryUi).toContain('htmlFor="inventory-site-filter"');
    expect(inventoryUi).toContain('id="inventory-location"');
    expect(inventoryUi).toContain('id="inventory-site-filter"');
    expect(inventoryUi).toContain("overflow-x-auto");
    expect(inventoryUi).toContain('role="alert"');
    expect(inventoryUi).toContain("sm:grid-cols-3");
  });
});
