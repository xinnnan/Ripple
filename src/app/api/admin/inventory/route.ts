import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const inventoryInputSchema = z.object({
  spare_part_id: z.string().uuid(),
  site_id: z.string().uuid(),
  quantity: z.number().int().nonnegative().default(0),
  min_quantity: z.number().int().nonnegative().default(0),
  max_quantity: z.number().int().nonnegative().nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
});

// GET /api/admin/inventory — List inventory (with optional site filter)
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createAdminClient();
  const { searchParams } = new URL(request.url);

  let query = supabase
    .from("spare_part_inventory")
    .select(`
      *,
      spare_part:spare_parts(*),
      site:sites(id, site_name, site_code)
    `)
    .order("created_at", { ascending: false });

  const siteId = searchParams.get("site_id");
  if (siteId) query = query.eq("site_id", siteId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Filter low stock in JS
  let result = data || [];
  const lowStock = searchParams.get("low_stock");
  if (lowStock === "true") {
    result = result.filter((item: { quantity: number; min_quantity: number }) => item.quantity < item.min_quantity);
  }

  return NextResponse.json({ data: result });
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

  const parsed = inventoryInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const supabase = createAdminClient();

  let row;
  try {
    const result = await supabase
      .from("spare_part_inventory")
      .upsert(
        {
          spare_part_id: data.spare_part_id,
          site_id: data.site_id,
          quantity: data.quantity,
          min_quantity: data.min_quantity,
          max_quantity: data.max_quantity ?? null,
          location: data.location ?? null,
        },
        { onConflict: "spare_part_id,site_id" }
      )
      .select(`
        *,
        spare_part:spare_parts(*),
        site:sites(id, site_name, site_code)
      `)
      .single();
    if (result.error) throw result.error;
    row = result.data;
  } catch (e) {
    console.error("POST /api/admin/inventory upsert failed:", e);
    return NextResponse.json(
      { error: "Failed to save inventory record" },
      { status: 500 }
    );
  }

  await logAudit({
    actorId: auth.userId,
    actorEmail: auth.email,
    actorRole: auth.role,
    entityType: "spare_part",
    entityId: data.spare_part_id,
    action: "updated",
    fieldName: "inventory",
    newValue: `${data.site_id}:${data.quantity}`,
    metadata: {
      site_id: data.site_id,
      quantity: data.quantity,
      min_quantity: data.min_quantity,
      max_quantity: data.max_quantity,
      location: data.location,
    },
  });

  return NextResponse.json({ data: row }, { status: 201 });
}
