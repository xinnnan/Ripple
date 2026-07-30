import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/030_atomic_field_service_order_commands.sql"
  ),
  "utf8"
);
const collectionRoute = readFileSync(
  join(process.cwd(), "src/app/api/field-service-orders/route.ts"),
  "utf8"
);
const itemRoute = readFileSync(
  join(process.cwd(), "src/app/api/field-service-orders/[id]/route.ts"),
  "utf8"
);

describe("migration 030 field-service integrity", () => {
  it("keeps create header, assignments, number, and audit in one command", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.create_field_service_order_atomic"
    );
    expect(migration).toContain("v_order_no := public.next_order_no();");
    expect(migration).toContain("INSERT INTO public.field_service_orders");
    expect(migration).toContain("INSERT INTO public.field_service_engineers");
    expect(migration).toContain("INSERT INTO public.audit_logs");
    expect(collectionRoute).toContain("createFieldServiceOrderAtomic");
    expect(collectionRoute).not.toContain("generate_fso_number");
    expect(collectionRoute).not.toMatch(
      /\.from\("field_service_orders"\)[\s\S]{0,120}\.insert\(/
    );
  });

  it("row-locks update and replaces assignments transactionally", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.apply_field_service_order_patch"
    );
    expect(migration).toContain("WHERE fso.id = p_order_id");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain(
      "DELETE FROM public.field_service_engineers"
    );
    expect(migration).toContain(
      "v_old_engineers IS DISTINCT FROM v_new_engineers"
    );
    expect(itemRoute).toContain("applyFieldServiceOrderPatch");
    expect(itemRoute).not.toContain(
      '.from("field_service_engineers").delete()'
    );
    expect(itemRoute).not.toMatch(
      /\.from\("field_service_orders"\)[\s\S]{0,120}\.update\(/
    );
  });

  it("validates actor, tenant, ticket, and active engineer identities", () => {
    expect(migration).toContain("u.role IN ('admin', 'engineer')");
    expect(migration).toContain("u.status = 'active'");
    expect(migration).toContain("s.status = 'active'");
    expect(migration).toContain("c.status IN ('active', 'trial')");
    expect(migration).toContain(
      "v_ticket_site_id IS DISTINCT FROM v_site_id"
    );
    expect(migration).toContain("u.role = 'engineer'");
    expect(migration).toContain("Duplicate engineer assignment");
  });

  it("enforces DATE-only schedules and database numeric bounds", () => {
    expect(migration).toContain("field_service_orders_schedule_bounds");
    expect(migration).toContain("field_service_orders_hour_bounds");
    expect(
      migration.split("!~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'").length - 1
    ).toBeGreaterThanOrEqual(4);
    expect(migration).toContain(
      "Scheduled end date cannot precede start date"
    );
    expect(collectionRoute).toContain("createFieldServiceOrderSchema");
    expect(itemRoute).toContain("updateFieldServiceOrderSchema");
  });

  it("limits both security-definer commands to the service role", () => {
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(2);
    expect(migration.match(/FROM PUBLIC, anon, authenticated/g)).toHaveLength(
      2
    );
    expect(migration.match(/TO service_role/g)).toHaveLength(2);
  });
});
