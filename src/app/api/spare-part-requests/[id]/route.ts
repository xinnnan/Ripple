import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isInternalEmail } from "@/lib/utils";
import type { UserRole } from "@/types/ticket";

export const dynamic = "force-dynamic";

// GET /api/spare-part-requests/[id] — Get request detail
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
    .from("spare_part_requests")
    .select(`
      *,
      site:sites(id, site_name, site_code),
      ticket:tickets(id, ticket_no, title),
      requester:users!spare_part_requests_requested_by_fkey(id, full_name),
      approver:users!spare_part_requests_approved_by_fkey(id, full_name),
      items:spare_part_request_items(*, spare_part:spare_parts(*))
    `)
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json({ data });
}

// PATCH /api/spare-part-requests/[id] — Update request (status changes, approve, ship, etc.)
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
    ? ["internal_admin", "internal_service_manager", "internal_engineer", "internal_solution_engineer"].includes(role)
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

    if (body.status === "approved") {
      updateFields.approved_by = authUser.id;
    }
    if (body.status === "shipped") {
      updateFields.shipped_at = new Date().toISOString();
      if (body.shipping_carrier) updateFields.shipping_carrier = body.shipping_carrier;
      if (body.shipping_tracking) updateFields.shipping_tracking = body.shipping_tracking;
    }
    if (body.status === "delivered") {
      updateFields.delivered_at = new Date().toISOString();
    }
  }

  if (body.notes !== undefined) updateFields.notes = body.notes;
  if (body.priority !== undefined) updateFields.priority = body.priority;
  if (body.shipping_carrier !== undefined) updateFields.shipping_carrier = body.shipping_carrier;
  if (body.shipping_tracking !== undefined) updateFields.shipping_tracking = body.shipping_tracking;

  const { data, error } = await admin
    .from("spare_part_requests")
    .update(updateFields)
    .eq("id", id)
    .select(`
      *,
      site:sites(id, site_name, site_code),
      ticket:tickets(id, ticket_no, title),
      requester:users!spare_part_requests_requested_by_fkey(id, full_name),
      approver:users!spare_part_requests_approved_by_fkey(id, full_name),
      items:spare_part_request_items(*, spare_part:spare_parts(*))
    `)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update fulfilled quantities for items if provided
  if (body.items && Array.isArray(body.items)) {
    for (const item of body.items) {
      if (item.id && item.fulfilled_quantity !== undefined) {
        await admin
          .from("spare_part_request_items")
          .update({ fulfilled_quantity: item.fulfilled_quantity })
          .eq("id", item.id);
      }
    }
  }

  return NextResponse.json({ data });
}
