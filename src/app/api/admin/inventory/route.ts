import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import {
  inventoryUpsertRequestSchema,
} from "@/lib/spare-parts/inventory-contracts";
import {
  AdminInventoryMutationError,
  upsertAdminInventoryAtomic,
} from "@/lib/spare-parts/inventory-mutations";
import { parseAdminInventoryListFilters } from "@/lib/admin-list-filters";

export const dynamic = "force-dynamic";

const INVENTORY_PROJECTION = `
  id,
  spare_part_id,
  site_id,
  quantity,
  min_quantity,
  max_quantity,
  location,
  last_restocked_at,
  created_at,
  updated_at,
  spare_part:spare_parts(id, part_number, part_name, category),
  site:sites(id, site_name, site_code)
`;

// GET /api/admin/inventory — List inventory (with optional site filter)
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const parsedFilters = parseAdminInventoryListFilters(searchParams);
  if (!parsedFilters.success) {
    return NextResponse.json(
      { error: "Invalid inventory filters" },
      { status: 400 }
    );
  }
  const filters = parsedFilters.data;
  const supabase = createAdminClient();

  try {
    let query = supabase
      .from("spare_part_inventory")
      .select(INVENTORY_PROJECTION)
      .order("created_at", { ascending: false });
    if (filters.siteId) query = query.eq("site_id", filters.siteId);

    const { data, error } = await query;
    if (error) {
      console.error("GET /api/admin/inventory failed:", { code: error.code });
      return NextResponse.json(
        { error: "Failed to fetch inventory" },
        { status: 500 }
      );
    }

    let result = data || [];
    if (filters.lowStock !== undefined) {
      result = result.filter(
        (item: { quantity: number; min_quantity: number }) =>
          filters.lowStock
            ? item.quantity < item.min_quantity
            : item.quantity >= item.min_quantity
      );
    }

    return NextResponse.json(
      { data: result },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("GET /api/admin/inventory error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/admin/inventory — Upsert inventory record (one row per
// spare_part_id + site_id; updates if the row exists, inserts otherwise).
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = inventoryUpsertRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }
  try {
    const inventory = await upsertAdminInventoryAtomic({
      supabase: createAdminClient(),
      actorId: auth.userId,
      input: parsed.data,
    });
    return NextResponse.json({ data: inventory }, { status: 201 });
  } catch (error) {
    if (error instanceof AdminInventoryMutationError) {
      if (error.code === "42501") {
        return NextResponse.json(
          { error: "Forbidden: Active admin access required" },
          { status: 403 }
        );
      }
      if (error.code === "55000") {
        return NextResponse.json(
          { error: "Inventory requires an active part and editable site" },
          { status: 409 }
        );
      }
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Inventory already exists for this part and site" },
          { status: 409 }
        );
      }
      if (
        ["22003", "22023", "22P02", "23503", "23514"].includes(
          error.code ?? ""
        )
      ) {
        return NextResponse.json(
          { error: "Invalid inventory values" },
          { status: 400 }
        );
      }
    }

    console.error("POST /api/admin/inventory command failed:", error);
    return NextResponse.json(
      { error: "Failed to save inventory record" },
      { status: 500 }
    );
  }
}
