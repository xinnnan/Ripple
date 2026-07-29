import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/028_atomic_spare_part_request_updates.sql"
  ),
  "utf8"
);
const route = readFileSync(
  join(process.cwd(), "src/app/api/spare-part-requests/[id]/route.ts"),
  "utf8"
);

describe("migration 028 spare-part request integrity", () => {
  it("serializes the parent and every supplied item", () => {
    expect(migration).toContain("WHERE spr.id = p_request_id");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain("WHERE item.id = v_item.id");
    expect(migration).toContain("AND item.request_id = p_request_id");
  });

  it("rejects duplicate, foreign, negative, and over-fulfilled items", () => {
    expect(migration).toContain("Duplicate spare part request item");
    expect(migration).toContain("Item does not belong to spare part request");
    expect(migration).toContain("v_item.fulfilled_quantity < 0");
    expect(migration).toContain(
      "v_item.fulfilled_quantity > v_ordered_quantity"
    );
    expect(migration).toContain(
      "spare_part_request_items_fulfilled_bounds"
    );
  });

  it("keeps header, item, and audit writes in one command", () => {
    expect(migration).toContain("UPDATE public.spare_part_requests AS spr");
    expect(migration).toContain(
      "UPDATE public.spare_part_request_items AS item"
    );
    expect(migration.match(/INSERT INTO public\.audit_logs/g)?.length).toBe(2);
    expect(route).toContain("applySparePartRequestPatch");
    expect(route).not.toContain('.eq("id", item.id)');
    expect(route).toContain("data: { id: updatedRequestId }");
  });

  it("limits the security-definer command to the service role", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toMatch(
      /FROM PUBLIC, anon, authenticated[\s\S]+TO service_role/
    );
    expect(migration).toContain("u.role IN ('admin', 'engineer')");
    expect(migration).toContain("u.status = 'active'");
  });
});
