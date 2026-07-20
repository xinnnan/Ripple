import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";

export const dynamic = "force-dynamic";

// GET /api/admin/spare-parts — List all spare parts (with optional filters)
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createAdminClient();
  const { searchParams } = new URL(request.url);

  let query = supabase
    .from("spare_parts")
    .select("*")
    .order("part_name");

  const category = searchParams.get("category");
  if (category) query = query.eq("category", category);

  const activeOnly = searchParams.get("active");
  if (activeOnly === "true") query = query.eq("is_active", true);

  const search = searchParams.get("search");
  if (search) {
    // Strip all PostgREST or-filter metacharacters (comma, parens,
    // percent, dot) so a search like "x,part_number.eq.42" can't
    // inject an extra filter condition. The trimmed, max-100-char
    // value is the only thing that ends up in the or() pattern.
    const sanitized = search
      .replace(/[%,().]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);
    if (sanitized) {
      const pattern = `%${sanitized}%`;
      query = query.or(
        `part_number.ilike.${pattern},part_name.ilike.${pattern}`
      );
    }
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// POST /api/admin/spare-parts — Create a new spare part
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createAdminClient();
  const body = await request.json();

  const { data, error } = await supabase
    .from("spare_parts")
    .insert({
      part_number: body.part_number,
      part_name: body.part_name,
      description: body.description || null,
      category: body.category || "other",
      unit: body.unit || "piece",
      unit_price: body.unit_price || null,
      compatible_models: body.compatible_models || null,
      image_url: body.image_url || null,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
