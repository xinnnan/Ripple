import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/029_atomic_spare_part_request_creation.sql"
  ),
  "utf8"
);
const route = readFileSync(
  join(process.cwd(), "src/app/api/spare-part-requests/route.ts"),
  "utf8"
);

describe("migration 029 spare-part request creation integrity", () => {
  it("keeps parent, items, and audit creation in one service-role command", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("INSERT INTO public.spare_part_requests");
    expect(migration).toContain(
      "INSERT INTO public.spare_part_request_items"
    );
    expect(migration).toContain("INSERT INTO public.audit_logs");
    expect(route).toContain("createSparePartRequestAtomic");
    expect(route).not.toContain('.from("spare_part_request_items")');
    expect(route).not.toMatch(
      /\.from\("spare_part_requests"\)[\s\S]{0,120}\.insert\(/
    );
  });

  it("validates the active actor and active tenant lifecycle", () => {
    expect(migration).toContain("u.role IN ('admin', 'engineer')");
    expect(migration).toContain("u.status = 'active'");
    expect(migration).toContain("s.status = 'active'");
    expect(migration).toContain("c.status IN ('active', 'trial')");
    expect(migration).toContain(
      "v_ticket_site_id IS DISTINCT FROM v_site_id"
    );
    expect(migration.match(/FOR SHARE/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("validates item count, identity, quantity, price, and catalog state", () => {
    expect(migration).toContain("v_item_count < 1 OR v_item_count > 100");
    expect(migration).toContain("Duplicate spare part request item");
    expect(migration).toContain("v_item.quantity <= 0");
    expect(migration).toContain("v_item.unit_price < 0");
    expect(migration).toContain("v_total_cost > 99999999.99");
    expect(migration).toContain("part.is_active");
    expect(migration).toContain(
      "spare_part_request_items_unit_price_bounds"
    );
  });

  it("allocates the request number inside the atomic command", () => {
    expect(migration).toContain(
      "v_request_no := public.next_request_no();"
    );
    expect(route).not.toContain("generate_spr_number");
    expect(route).not.toContain("next_request_no");
  });

  it("removes public access from every current sequence-number RPC", () => {
    for (const functionName of [
      "next_ticket_no",
      "next_request_no",
      "next_order_no",
      "generate_spr_number",
      "generate_fso_number",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${functionName}\\(\\)` +
            `[\\s\\S]{0,80}FROM PUBLIC, anon, authenticated`
        )
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION public.${functionName}() TO service_role`
      );
    }

    expect(migration.match(/SET search_path = ''/g)?.length).toBeGreaterThanOrEqual(
      4
    );
  });

  it("requires at least one unique item at the HTTP boundary", () => {
    expect(route).toContain(".min(1)");
    expect(route).toContain("Duplicate spare parts are not allowed");
    expect(route).toContain("{ status: 201 }");
    expect(route).toContain(
      "Request created; detail refresh is temporarily unavailable"
    );
  });
});
