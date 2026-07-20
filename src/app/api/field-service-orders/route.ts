import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/ticket";
import { isInternalUser } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SERVICE_TYPES = [
  "repair", "installation", "inspection", "commissioning",
  "training", "emergency", "maintenance",
] as const;

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const createFSOSchema = z.object({
  ticket_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid(),
  service_type: z.enum(SERVICE_TYPES),
  priority: z.enum(PRIORITIES).default("normal"),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  scheduled_date: z.string().datetime().nullable().optional(),
  scheduled_end_date: z.string().datetime().nullable().optional(),
  estimated_hours: z.number().nonnegative().finite().nullable().optional(),
  travel_required: z.boolean().optional(),
  travel_from: z.string().trim().max(200).nullable().optional(),
  engineers: z.array(z.object({
    engineer_id: z.string().uuid(),
    role: z.string().trim().max(50).optional(),
  })).max(20).optional(),
});

// GET /api/field-service-orders — List field service orders
export async function GET(request: NextRequest) {
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
      console.error("GET /api/field-service-orders failed:", error);
      return NextResponse.json({ error: "Failed to fetch field service orders" }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (e) {
    console.error("GET /api/field-service-orders error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/field-service-orders — Create a field service order
export async function POST(request: NextRequest) {
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
      return NextResponse.json({ error: "Forbidden: Internal access required" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const data = createFSOSchema.parse(body);

    const admin = createAdminClient();

    // Generate order number
    const { data: seqData, error: seqErr } = await admin.rpc("generate_fso_number");
    if (seqErr || typeof seqData !== "string") {
      console.error("generate_fso_number RPC failed:", seqErr);
      return NextResponse.json({ error: "Failed to generate order number" }, { status: 500 });
    }
    const orderNo = seqData;

    // Create the order
    const { data: order, error } = await admin
      .from("field_service_orders")
      .insert({
        order_no: orderNo,
        ticket_id: data.ticket_id ?? null,
        site_id: data.site_id,
        service_type: data.service_type,
        status: "scheduled",
        priority: data.priority,
        title: data.title,
        description: data.description ?? null,
        scheduled_date: data.scheduled_date ?? null,
        scheduled_end_date: data.scheduled_end_date ?? null,
        estimated_hours: data.estimated_hours ?? null,
        travel_required: data.travel_required !== undefined ? data.travel_required : true,
        travel_from: data.travel_from ?? null,
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
      console.error("POST /api/field-service-orders insert failed:", error);
      return NextResponse.json({ error: "Failed to create field service order" }, { status: 500 });
    }

    // Assign engineers if provided
    if (data.engineers && data.engineers.length > 0) {
      const engineerInserts = data.engineers.map((e) => ({
        order_id: order.id,
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

    await logAudit({
      actorId: authUser.id,
      actorEmail: email,
      actorRole: role,
      entityType: "field_service_order",
      entityId: order.id,
      action: "created",
      newValue: orderNo,
      metadata: {
        site_id: data.site_id,
        service_type: data.service_type,
        priority: data.priority,
        ticket_id: data.ticket_id ?? null,
        scheduled_date: data.scheduled_date ?? null,
      },
    });

    return NextResponse.json({ data: order }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Create FSO error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
