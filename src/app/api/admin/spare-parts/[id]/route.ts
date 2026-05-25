import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";

export const dynamic = "force-dynamic";

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
  const supabase = createAdminClient();
  const body = await request.json();

  const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.part_number !== undefined) updateFields.part_number = body.part_number;
  if (body.part_name !== undefined) updateFields.part_name = body.part_name;
  if (body.description !== undefined) updateFields.description = body.description;
  if (body.category !== undefined) updateFields.category = body.category;
  if (body.unit !== undefined) updateFields.unit = body.unit;
  if (body.unit_price !== undefined) updateFields.unit_price = body.unit_price;
  if (body.compatible_models !== undefined) updateFields.compatible_models = body.compatible_models;
  if (body.image_url !== undefined) updateFields.image_url = body.image_url;
  if (body.is_active !== undefined) updateFields.is_active = body.is_active;

  const { data, error } = await supabase
    .from("spare_parts")
    .update(updateFields)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
