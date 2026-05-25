import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";

export const dynamic = "force-dynamic";

// PATCH /api/admin/inventory/[id] — Update inventory quantity
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  const supabase = createAdminClient();
  const body = await request.json();

  const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.quantity !== undefined) {
    updateFields.quantity = body.quantity;
    updateFields.last_restocked_at = new Date().toISOString();
  }
  if (body.min_quantity !== undefined) updateFields.min_quantity = body.min_quantity;
  if (body.max_quantity !== undefined) updateFields.max_quantity = body.max_quantity;
  if (body.location !== undefined) updateFields.location = body.location;

  const { data, error } = await supabase
    .from("spare_part_inventory")
    .update(updateFields)
    .eq("id", id)
    .select(`
      *,
      spare_part:spare_parts(*),
      site:sites(id, site_name, site_code)
    `)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
