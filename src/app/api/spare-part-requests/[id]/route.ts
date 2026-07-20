import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/ticket";
import { isInternalUser } from "@/lib/roles";
import { logDiff } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SPR_STATUSES = ["requested", "approved", "shipped", "delivered", "cancelled"] as const;
const SPR_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const updateSPRSchema = z.object({
  status: z.enum(SPR_STATUSES).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  priority: z.enum(SPR_PRIORITIES).optional(),
  shipping_carrier: z.string().trim().max(100).nullable().optional(),
  shipping_tracking: z.string().trim().max(200).nullable().optional(),
  items: z.array(z.object({
    id: z.string().uuid(),
    fulfilled_quantity: z.number().int().nonnegative(),
  })).max(100).optional(),
});

// GET /api/spare-part-requests/[id] — Get request detail
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
      return NextResponse.json({ error: "Spare part request not found" }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (e) {
    console.error("GET /api/spare-part-requests/[id] error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/spare-part-requests/[id] — Update request (status changes, approve, ship, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
    const isInternal = isInternalUser({ role, email });

    if (!isInternal) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const data = updateSPRSchema.parse(body);

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Fetch before-state for audit
    const before = await admin
      .from("spare_part_requests")
      .select("status, notes, priority, shipping_carrier, shipping_tracking, request_no")
      .eq("id", id)
      .maybeSingle();
    if (before.error) {
      console.error("PATCH /api/spare-part-requests/[id] before fetch failed:", before.error);
      return NextResponse.json({ error: "Failed to load request" }, { status: 500 });
    }
    if (!before.data) {
      return NextResponse.json({ error: "Spare part request not found" }, { status: 404 });
    }

    const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // Status transitions
    if (data.status) {
      updateFields.status = data.status;
      if (data.status === "approved") {
        updateFields.approved_by = authUser.id;
      }
      if (data.status === "shipped") {
        updateFields.shipped_at = new Date().toISOString();
      }
      if (data.status === "delivered") {
        updateFields.delivered_at = new Date().toISOString();
      }
    }

    if (data.notes !== undefined) updateFields.notes = data.notes;
    if (data.priority !== undefined) updateFields.priority = data.priority;
    if (data.shipping_carrier !== undefined) updateFields.shipping_carrier = data.shipping_carrier;
    if (data.shipping_tracking !== undefined) updateFields.shipping_tracking = data.shipping_tracking;

    const { data: spr, error } = await admin
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
      console.error("PATCH /api/spare-part-requests/[id] update failed:", error);
      return NextResponse.json({ error: "Failed to update spare part request" }, { status: 500 });
    }

    // Update fulfilled quantities for items if provided
    if (data.items && data.items.length > 0) {
      for (const item of data.items) {
        await admin
          .from("spare_part_request_items")
          .update({ fulfilled_quantity: item.fulfilled_quantity })
          .eq("id", item.id);
      }
    }

    // Audit
    const auditAfter: Record<string, unknown> = {};
    for (const k of Object.keys(data)) {
      if (k === "items") continue;
      auditAfter[k] = (data as Record<string, unknown>)[k];
    }
    if (data.status === "approved") {
      auditAfter.approved_by = authUser.id;
    }
    await logDiff({
      actorId: authUser.id,
      actorEmail: email,
      actorRole: role,
      entityType: "part_request",
      entityId: id,
      before: before.data as Record<string, unknown>,
      after: auditAfter,
      metadata: {
        request_no: before.data.request_no,
        item_fulfillment_change: data.items !== undefined,
      },
    });

    return NextResponse.json({ data: spr });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Update SPR error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
