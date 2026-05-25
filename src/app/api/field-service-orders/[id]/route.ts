import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isInternalEmail } from "@/lib/utils";
import type { UserRole } from "@/types/ticket";
import { INTERNAL_ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

// GET /api/field-service-orders/[id] — Get order detail
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("field_service_orders")
    .select(`
      *,
      site:sites(id, site_name, site_code),
      ticket:tickets(id, ticket_no, title),
      requester:users!field_service_orders_requested_by_fkey(id, full_name),
      completer:users!field_service_orders_completed_by_fkey(id, full_name),
      engineers:field_service_engineers(*, engineer:users(id, full_name, email))
    `)
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json({ data });
}

// PATCH /api/field-service-orders/[id] — Update order
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    ? INTERNAL_ROLES.includes(role)
    : email ? isInternalEmail(email) : false;

  if (!isInternal) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const admin = createAdminClient();
  const body = await request.json();

  const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // Status transitions
  if (body.status) {
    updateFields.status = body.status;

    if (body.status === "in_progress") {
      // Mark as in progress
    }
    if (body.status === "completed") {
      updateFields.completed_by = authUser.id;
      updateFields.completed_at = new Date().toISOString();
      if (body.actual_hours !== undefined) updateFields.actual_hours = body.actual_hours;
      if (body.completion_report !== undefined) updateFields.completion_report = body.completion_report;
      if (body.completion_notes !== undefined) updateFields.completion_notes = body.completion_notes;
    }
  }

  if (body.title !== undefined) updateFields.title = body.title;
  if (body.description !== undefined) updateFields.description = body.description;
  if (body.service_type !== undefined) updateFields.service_type = body.service_type;
  if (body.priority !== undefined) updateFields.priority = body.priority;
  if (body.scheduled_date !== undefined) updateFields.scheduled_date = body.scheduled_date;
  if (body.scheduled_end_date !== undefined) updateFields.scheduled_end_date = body.scheduled_end_date;
  if (body.estimated_hours !== undefined) updateFields.estimated_hours = body.estimated_hours;
  if (body.actual_hours !== undefined) updateFields.actual_hours = body.actual_hours;
  if (body.travel_required !== undefined) updateFields.travel_required = body.travel_required;
  if (body.travel_from !== undefined) updateFields.travel_from = body.travel_from;
  if (body.completion_report !== undefined) updateFields.completion_report = body.completion_report;
  if (body.completion_notes !== undefined) updateFields.completion_notes = body.completion_notes;

  const { data, error } = await admin
    .from("field_service_orders")
    .update(updateFields)
    .eq("id", id)
    .select(`
      *,
      site:sites(id, site_name, site_code),
      ticket:tickets(id, ticket_no, title),
      requester:users!field_service_orders_requested_by_fkey(id, full_name),
      completer:users!field_service_orders_completed_by_fkey(id, full_name),
      engineers:field_service_engineers(*, engineer:users(id, full_name, email))
    `)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update engineer assignments if provided
  if (body.engineers && Array.isArray(body.engineers)) {
    // Delete existing and re-insert
    await admin.from("field_service_engineers").delete().eq("order_id", id);

    if (body.engineers.length > 0) {
      const engineerInserts = body.engineers.map((e: { engineer_id: string; role?: string }) => ({
        order_id: id,
        engineer_id: e.engineer_id,
        role: e.role || "engineer",
      }));

      await admin.from("field_service_engineers").insert(engineerInserts);
    }
  }

  return NextResponse.json({ data });
}
