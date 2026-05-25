import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isInternalEmail } from "@/lib/utils";
import type { UserRole } from "@/types/ticket";

export const dynamic = "force-dynamic";

// GET /api/spare-part-requests — List spare part requests
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userProfile } = await supabase
    .from("users")
    .select("role, email")
    .eq("id", authUser.id)
    .single();

  const role = userProfile?.role as UserRole | undefined;
  const email = userProfile?.email as string | undefined;
  const isInternal = role
    ? ["internal_admin", "internal_service_manager", "internal_engineer", "internal_solution_engineer"].includes(role)
    : email ? isInternalEmail(email) : false;

  const admin = createAdminClient();
  const { searchParams } = new URL(request.url);

  let query = admin
    .from("spare_part_requests")
    .select(`
      *,
      site:sites(id, site_name, site_code),
      ticket:tickets(id, ticket_no, title),
      requester:users!spare_part_requests_requested_by_fkey(id, full_name),
      approver:users!spare_part_requests_approved_by_fkey(id, full_name),
      items:spare_part_request_items(*, spare_part:spare_parts(*))
    `)
    .order("created_at", { ascending: false });

  // Customer users can only see their site's requests
  if (!isInternal) {
    const { data: memberships } = await supabase
      .from("site_members")
      .select("site_id")
      .eq("user_id", authUser.id);

    const siteIds = (memberships || []).map((m) => m.site_id);
    if (siteIds.length === 0) {
      return NextResponse.json({ data: [] });
    }
    query = query.in("site_id", siteIds);
  }

  // Filters
  const status = searchParams.get("status");
  if (status) query = query.eq("status", status);

  const siteId = searchParams.get("site_id");
  if (siteId) query = query.eq("site_id", siteId);

  const ticketId = searchParams.get("ticket_id");
  if (ticketId) query = query.eq("ticket_id", ticketId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// POST /api/spare-part-requests — Create a spare part request
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userProfile } = await supabase
    .from("users")
    .select("role, email")
    .eq("id", authUser.id)
    .single();

  const role = userProfile?.role as UserRole | undefined;
  const email = userProfile?.email as string | undefined;
  const isInternal = role
    ? ["internal_admin", "internal_service_manager", "internal_engineer", "internal_solution_engineer"].includes(role)
    : email ? isInternalEmail(email) : false;

  if (!isInternal) {
    return NextResponse.json({ error: "Forbidden: Internal access required" }, { status: 403 });
  }

  const admin = createAdminClient();
  const body = await request.json();

  // Generate request number
  const { data: seqData } = await admin.rpc("generate_spr_number");
  const requestNo = seqData as string;

  // Calculate total cost
  let totalCost = 0;
  if (body.items && Array.isArray(body.items)) {
    for (const item of body.items) {
      totalCost += (item.unit_price || 0) * (item.quantity || 0);
    }
  }

  // Create the request
  const { data, error } = await admin
    .from("spare_part_requests")
    .insert({
      request_no: requestNo,
      ticket_id: body.ticket_id || null,
      site_id: body.site_id,
      status: "requested",
      priority: body.priority || "normal",
      notes: body.notes || null,
      requested_by: authUser.id,
      total_cost: totalCost > 0 ? totalCost : null,
    })
    .select(`
      *,
      site:sites(id, site_name, site_code),
      ticket:tickets(id, ticket_no, title),
      requester:users!spare_part_requests_requested_by_fkey(id, full_name)
    `)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Create line items
  if (body.items && Array.isArray(body.items) && body.items.length > 0) {
    const items = body.items.map((item: { spare_part_id: string; quantity: number; unit_price?: number; notes?: string }) => ({
      request_id: data.id,
      spare_part_id: item.spare_part_id,
      quantity: item.quantity,
      fulfilled_quantity: 0,
      unit_price: item.unit_price || null,
      notes: item.notes || null,
    }));

    const { error: itemsError } = await admin
      .from("spare_part_request_items")
      .insert(items);

    if (itemsError) {
      console.error("Failed to create request items:", itemsError);
    }
  }

  return NextResponse.json({ data }, { status: 201 });
}
