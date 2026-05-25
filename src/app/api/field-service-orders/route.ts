import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isInternalEmail } from "@/lib/utils";
import type { UserRole } from "@/types/ticket";

export const dynamic = "force-dynamic";

// GET /api/field-service-orders — List field service orders
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
    .from("field_service_orders")
    .select(`
      *,
      site:sites(id, site_name, site_code),
      ticket:tickets(id, ticket_no, title),
      requester:users!field_service_orders_requested_by_fkey(id, full_name),
      completer:users!field_service_orders_completed_by_fkey(id, full_name),
      engineers:field_service_engineers(*, engineer:users(id, full_name, email))
    `)
    .order("created_at", { ascending: false });

  // Customer users can only see their site's orders
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

  const serviceType = searchParams.get("service_type");
  if (serviceType) query = query.eq("service_type", serviceType);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// POST /api/field-service-orders — Create a field service order
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

  // Generate order number
  const { data: seqData } = await admin.rpc("generate_fso_number");
  const orderNo = seqData as string;

  // Create the order
  const { data, error } = await admin
    .from("field_service_orders")
    .insert({
      order_no: orderNo,
      ticket_id: body.ticket_id || null,
      site_id: body.site_id,
      service_type: body.service_type,
      status: "scheduled",
      priority: body.priority || "normal",
      title: body.title,
      description: body.description || null,
      scheduled_date: body.scheduled_date || null,
      scheduled_end_date: body.scheduled_end_date || null,
      estimated_hours: body.estimated_hours || null,
      travel_required: body.travel_required !== undefined ? body.travel_required : true,
      travel_from: body.travel_from || null,
      requested_by: authUser.id,
    })
    .select(`
      *,
      site:sites(id, site_name, site_code),
      ticket:tickets(id, ticket_no, title),
      requester:users!field_service_orders_requested_by_fkey(id, full_name)
    `)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Assign engineers if provided
  if (body.engineers && Array.isArray(body.engineers) && body.engineers.length > 0) {
    const engineerInserts = body.engineers.map((e: { engineer_id: string; role?: string }) => ({
      order_id: data.id,
      engineer_id: e.engineer_id,
      role: e.role || "engineer",
    }));

    const { error: engError } = await admin
      .from("field_service_engineers")
      .insert(engineerInserts);

    if (engError) {
      console.error("Failed to assign engineers:", engError);
    }
  }

  return NextResponse.json({ data }, { status: 201 });
}
