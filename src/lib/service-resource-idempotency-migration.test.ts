import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/049_idempotent_service_resource_creation.sql"
  ),
  "utf8"
);
const spareMutation = readFileSync(
  resolve(root, "src/lib/spare-parts/mutations.ts"),
  "utf8"
);
const fieldMutation = readFileSync(
  resolve(root, "src/lib/field-service/mutations.ts"),
  "utf8"
);
const spareRoute = readFileSync(
  resolve(root, "src/app/api/spare-part-requests/route.ts"),
  "utf8"
);
const fieldRoute = readFileSync(
  resolve(root, "src/app/api/field-service-orders/route.ts"),
  "utf8"
);
const spareForm = readFileSync(
  resolve(
    root,
    "src/app/(auth)/admin/part-requests/create/create-part-request-form.tsx"
  ),
  "utf8"
);
const fieldForm = readFileSync(
  resolve(
    root,
    "src/app/(auth)/admin/field-service/create/create-field-service-form.tsx"
  ),
  "utf8"
);

describe("migration 049 replay-safe service-resource creation", () => {
  it("creates bounded, cascading, forced-RLS service-only ledgers", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    for (const table of [
      "spare_part_request_creation_requests",
      "field_service_order_creation_requests",
    ]) {
      expect(migration).toContain(`CREATE TABLE public.${table}`);
      expect(migration).toContain(
        `ALTER TABLE public.${table}\n  FORCE ROW LEVEL SECURITY`
      );
      expect(migration).toContain(`REVOKE ALL ON TABLE public.${table}`);
      expect(migration).toContain(
        `ON TABLE public.${table}\n  TO service_role`
      );
    }
    expect(migration.match(/ON DELETE CASCADE/g)).toHaveLength(2);
    expect(migration.match(/BETWEEN 16 AND 200/g)).toHaveLength(4);
  });

  it("serializes each key and compares immutable request snapshots", () => {
    expect(migration.match(/pg_catalog\.pg_advisory_xact_lock/g)).toHaveLength(
      2
    );
    expect(migration.match(/FOR UPDATE OF request/g)).toHaveLength(2);
    expect(migration.match(/request_snapshot jsonb NOT NULL/g)).toHaveLength(2);
    expect(migration.match(/v_existing_snapshot IS DISTINCT FROM/g)).toHaveLength(
      2
    );
    expect(migration).toContain(
      "Spare part request idempotency key was already used for different input"
    );
    expect(migration).toContain(
      "Field service order idempotency key was already used for different input"
    );
  });

  it("wraps both existing atomic commands in the receipt transaction", () => {
    expect(migration).toContain(
      "v_request_id := public.create_spare_part_request_atomic("
    );
    expect(migration).toContain(
      "v_order_id := public.create_field_service_order_atomic("
    );
    expect(migration).toContain(
      "INSERT INTO public.spare_part_request_creation_requests"
    );
    expect(migration).toContain(
      "INSERT INTO public.field_service_order_creation_requests"
    );
  });

  it("limits both wrapper commands to the service role", () => {
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(2);
    expect(migration.match(/FROM PUBLIC, anon, authenticated;/g)).toHaveLength(
      4
    );
    expect(migration.match(/\) TO service_role;/g)).toHaveLength(2);
  });

  it("routes both APIs through the idempotent wrappers and stable conflicts", () => {
    expect(spareMutation).toContain(
      '"create_spare_part_request_idempotent_atomic"'
    );
    expect(fieldMutation).toContain(
      '"create_field_service_order_idempotent_atomic"'
    );
    for (const route of [spareRoute, fieldRoute]) {
      expect(route).toContain("IDEMPOTENCY_KEY_HEADER");
      expect(route).toContain("normalizeIdempotencyKey");
      expect(route).toContain("generateIdempotencyKey");
      expect(route).toContain("status: 409");
      expect(route).toContain('"Cache-Control": "private, no-store"');
    }
  });

  it("retains one browser key until normalized creation input changes", () => {
    for (const form of [spareForm, fieldForm]) {
      expect(form).toContain("creationAttemptRef");
      expect(form).toContain("fingerprint !== requestBody");
      expect(form).toContain("generateIdempotencyKey()");
      expect(form).toContain("IDEMPOTENCY_KEY_HEADER");
      expect(form).toContain("body: requestBody");
    }
  });
});
