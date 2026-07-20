import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const inventoryPatchSchema = z.object({
  quantity: z.number().int().nonnegative().optional(),
  min_quantity: z.number().int().nonnegative().optional(),
  max_quantity: z.number().int().nonnegative().nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
});

// PATCH /api/admin/inventory/[id] — Update inventory quantity / thresholds
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = inventoryPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const supabase = createAdminClient();

  const before = await supabase
    .from("spare_part_inventory")
    .select("quantity, min_quantity, max_quantity, location, spare_part_id, site_id")
    .eq("id", id)
    .maybeSingle();
  if (before.error) {
    console.error("PATCH /api/admin/inventory/[id] before fetch failed:", before.error);
    return NextResponse.json({ error: "Failed to load inventory record" }, { status: 500 });
  }
  if (!before.data) {
    return NextResponse.json({ error: "Inventory record not found" }, { status: 404 });
  }

  const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(data)) {
    updateFields[k] = v;
  }
  // quantity changes are a "restock" event
  if (data.quantity !== undefined) {
    updateFields.last_restocked_at = new Date().toISOString();
  }

  let row;
  try {
    const result = await supabase
      .from("spare_part_inventory")
      .update(updateFields)
      .eq("id", id)
      .select(`
        *,
        spare_part:spare_parts(*),
        site:sites(id, site_name, site_code)
      `)
      .single();
    if (result.error) throw result.error;
    row = result.data;
  } catch (e) {
    console.error("PATCH /api/admin/inventory/[id] update failed:", e);
    return NextResponse.json(
      { error: "Failed to update inventory record" },
      { status: 500 }
    );
  }

  for (const [field, newVal] of Object.entries(data)) {
    const oldVal = (before.data as Record<string, unknown>)[field];
    if (oldVal === newVal) continue;
    await logAudit({
      actorId: auth.userId,
      actorEmail: auth.email,
      actorRole: auth.role,
      entityType: "spare_part",
      entityId: before.data.spare_part_id,
      action: "updated",
      fieldName: `inventory.${field}`,
      oldValue: oldVal == null ? null : String(oldVal),
      newValue: newVal == null ? null : String(newVal),
      metadata: {
        inventory_id: id,
        site_id: before.data.site_id,
      },
    });
  }

  return NextResponse.json({ data: row });
}
