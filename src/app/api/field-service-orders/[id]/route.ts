import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/ticket";
import { isInternalUser } from "@/lib/roles";
import { logDiff } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const FSO_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
const FSO_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const SERVICE_TYPES = [
  "repair", "installation", "inspection", "commissioning",
  "training", "emergency", "maintenance",
] as const;

const updateFSOSchema = z.object({
  status: z.enum(FSO_STATUSES).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  service_type: z.enum(SERVICE_TYPES).optional(),
  priority: z.enum(FSO_PRIORITIES).optional(),
  scheduled_date: z.string().datetime().nullable().optional(),
  scheduled_end_date: z.string().datetime().nullable().optional(),
  estimated_hours: z.number().nonnegative().finite().nullable().optional(),
  actual_hours: z.number().nonnegative().finite().nullable().optional(),
  travel_required: z.boolean().optional(),
  travel_from: z.string().trim().max(200).nullable().optional(),
  completion_report: z.string().trim().max(20000).nullable().optional(),
  completion_notes: z.string().trim().max(2000).nullable().optional(),
  engineers: z.array(z.object({
    engineer_id: z.string().uuid(),
    role: z.string().trim().max(50).optional(),
  })).max(20).optional(),
});

// GET /api/field-service-orders/[id] — Get order detail
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
      return NextResponse.json({ error: "Field service order not found" }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (e) {
    console.error("GET /api/field-service-orders/[id] error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/field-service-orders/[id] — Update order
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
    const data = updateFSOSchema.parse(body);

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Fetch before-state for audit diff
    const before = await admin
      .from("field_service_orders")
      .select("status, title, description, service_type, priority, scheduled_date, scheduled_end_date, estimated_hours, actual_hours, travel_required, travel_from, completion_report, completion_notes")
      .eq("id", id)
      .maybeSingle();
    if (before.error) {
      console.error("PATCH /api/field-service-orders/[id] before fetch failed:", before.error);
      return NextResponse.json({ error: "Failed to load order" }, { status: 500 });
    }
    if (!before.data) {
      return NextResponse.json({ error: "Field service order not found" }, { status: 404 });
    }

    const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // Status transitions
    if (data.status) {
      updateFields.status = data.status;
      if (data.status === "completed") {
        updateFields.completed_by = authUser.id;
        updateFields.completed_at = new Date().toISOString();
      }
    }

    if (data.title !== undefined) updateFields.title = data.title;
    if (data.description !== undefined) updateFields.description = data.description;
    if (data.service_type !== undefined) updateFields.service_type = data.service_type;
    if (data.priority !== undefined) updateFields.priority = data.priority;
    if (data.scheduled_date !== undefined) updateFields.scheduled_date = data.scheduled_date;
    if (data.scheduled_end_date !== undefined) updateFields.scheduled_end_date = data.scheduled_end_date;
    if (data.estimated_hours !== undefined) updateFields.estimated_hours = data.estimated_hours;
    if (data.actual_hours !== undefined) updateFields.actual_hours = data.actual_hours;
    if (data.travel_required !== undefined) updateFields.travel_required = data.travel_required;
    if (data.travel_from !== undefined) updateFields.travel_from = data.travel_from;
    if (data.completion_report !== undefined) updateFields.completion_report = data.completion_report;
    if (data.completion_notes !== undefined) updateFields.completion_notes = data.completion_notes;

    const { data: order, error } = await admin
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
      console.error("PATCH /api/field-service-orders/[id] update failed:", error);
      return NextResponse.json({ error: "Failed to update field service order" }, { status: 500 });
    }

    // Update engineer assignments if provided
    if (data.engineers !== undefined) {
      // Delete existing and re-insert
      await admin.from("field_service_engineers").delete().eq("order_id", id);

      if (data.engineers.length > 0) {
        const engineerInserts = data.engineers.map((e) => ({
          order_id: id,
          engineer_id: e.engineer_id,
          role: e.role || "engineer",
        }));
        await admin.from("field_service_engineers").insert(engineerInserts);
      }
    }

    // Audit log — per-field diff
    const auditAfter: Record<string, unknown> = {};
    for (const k of Object.keys(data)) {
      if (k === "engineers") continue;
      auditAfter[k] = (data as Record<string, unknown>)[k];
    }
    if (data.status === "completed") {
      auditAfter.completed_by = authUser.id;
    }
    await logDiff({
      actorId: authUser.id,
      actorEmail: email,
      actorRole: role,
      entityType: "field_service_order",
      entityId: id,
      before: before.data as Record<string, unknown>,
      after: auditAfter,
      metadata: { order_no: order.order_no, engineer_change: data.engineers !== undefined },
    });

    return NextResponse.json({ data: order });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Update FSO error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
