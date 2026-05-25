import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";

export const dynamic = "force-dynamic";

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

// POST /api/admin/inventory — Add inventory record
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createAdminClient();
  const body = await request.json();

  const { data, error } = await supabase
    .from("spare_part_inventory")
    .upsert({
      spare_part_id: body.spare_part_id,
      site_id: body.site_id,
      quantity: body.quantity || 0,
      min_quantity: body.min_quantity || 0,
      max_quantity: body.max_quantity || null,
      location: body.location || null,
    }, { onConflict: "spare_part_id,site_id" })
    .select(`
      *,
      spare_part:spare_parts(*),
      site:sites(id, site_name, site_code)
    `)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
