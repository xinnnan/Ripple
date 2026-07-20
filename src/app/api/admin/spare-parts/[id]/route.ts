import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const PART_CATEGORIES = [
  "sensor", "motor", "controller", "belt", "roller", "cable",
  "connector", "battery", "pcb", "mechanical", "safety", "tool", "other",
] as const;

const PART_UNITS = ["piece", "set", "meter", "kg", "liter", "roll"] as const;

const partPatchSchema = z.object({
  part_number: z.string().trim().min(1).max(100).optional(),
  part_name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  category: z.enum(PART_CATEGORIES).optional(),
  unit: z.enum(PART_UNITS).optional(),
  unit_price: z.number().nonnegative().finite().nullable().optional(),
  compatible_models: z.array(z.string().trim().min(1).max(100)).max(50).nullable().optional(),
  image_url: z.string().url().max(2000).nullable().optional(),
  is_active: z.boolean().optional(),
});

// GET /api/admin/spare-parts/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("spare_parts")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json({ data });
}

// PATCH /api/admin/spare-parts/[id]
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

  const parsed = partPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const supabase = createAdminClient();

  // Fetch the current row so we can log a meaningful diff and detect
  // "no-op" PATCHes early.
  const before = await supabase
    .from("spare_parts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (before.error) {
    console.error("PATCH /api/admin/spare-parts/[id] before fetch failed:", before.error);
    return NextResponse.json({ error: "Failed to load spare part" }, { status: 500 });
  }
  if (!before.data) {
    return NextResponse.json({ error: "Spare part not found" }, { status: 404 });
  }

  const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(data)) {
    updateFields[k] = v;
  }

  let row;
  try {
    const result = await supabase
      .from("spare_parts")
      .update(updateFields)
      .eq("id", id)
      .select()
      .single();
    if (result.error) throw result.error;
    row = result.data;
  } catch (e) {
    console.error("PATCH /api/admin/spare-parts/[id] update failed:", e);
    return NextResponse.json(
      { error: "Failed to update spare part" },
      { status: 500 }
    );
  }

  // One audit entry per changed field. Spare-part edits are rare
  // and admin-only, so the noise is fine.
  for (const [field, newVal] of Object.entries(data)) {
    const oldVal = (before.data as Record<string, unknown>)[field];
    if (oldVal === newVal) continue;
    await logAudit({
      actorId: auth.userId,
      actorEmail: auth.email,
      actorRole: auth.role,
      entityType: "spare_part",
      entityId: id,
      action: "updated",
      fieldName: field,
      oldValue: oldVal == null ? null : String(oldVal),
      newValue: newVal == null ? null : String(newVal),
    });
  }

  return NextResponse.json({ data: row });
}
