import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/ticket";
import { isInternalUser } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const createSPRSchema = z.object({
  ticket_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid(),
  priority: z.enum(PRIORITIES).default("normal"),
  notes: z.string().trim().max(5000).nullable().optional(),
  items: z.array(z.object({
    spare_part_id: z.string().uuid(),
    quantity: z.number().int().positive(),
    unit_price: z.number().nonnegative().finite().nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })).max(100).optional(),
});

// GET /api/spare-part-requests — List spare part requests
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
      console.error("GET /api/spare-part-requests failed:", error);
      return NextResponse.json({ error: "Failed to fetch spare part requests" }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (e) {
    console.error("GET /api/spare-part-requests error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/spare-part-requests — Create a spare part request
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
    const data = createSPRSchema.parse(body);

    const admin = createAdminClient();

    // Generate request number
    const { data: seqData, error: seqErr } = await admin.rpc("generate_spr_number");
    if (seqErr || typeof seqData !== "string") {
      console.error("generate_spr_number RPC failed:", seqErr);
      return NextResponse.json({ error: "Failed to generate request number" }, { status: 500 });
    }
    const requestNo = seqData;

    // Calculate total cost from items (server-side, never trust body total)
    let totalCost: number | null = null;
    if (data.items && data.items.length > 0) {
      totalCost = data.items.reduce(
        (sum, item) => sum + (item.unit_price ?? 0) * item.quantity,
        0
      );
      if (totalCost === 0) totalCost = null;
    }

    // Create the request
    const { data: spr, error } = await admin
      .from("spare_part_requests")
      .insert({
        request_no: requestNo,
        ticket_id: data.ticket_id ?? null,
        site_id: data.site_id,
        status: "requested",
        priority: data.priority,
        notes: data.notes ?? null,
        requested_by: authUser.id,
        total_cost: totalCost,
      })
      .select(`
        *,
        site:sites(id, site_name, site_code),
        ticket:tickets(id, ticket_no, title),
        requester:users!spare_part_requests_requested_by_fkey(id, full_name)
      `)
      .single();

    if (error) {
      console.error("POST /api/spare-part-requests insert failed:", error);
      return NextResponse.json({ error: "Failed to create spare part request" }, { status: 500 });
    }

    // Create line items
    if (data.items && data.items.length > 0) {
      const items = data.items.map((item) => ({
        request_id: spr.id,
        spare_part_id: item.spare_part_id,
        quantity: item.quantity,
        fulfilled_quantity: 0,
        unit_price: item.unit_price ?? null,
        notes: item.notes ?? null,
      }));

      const { error: itemsError } = await admin
        .from("spare_part_request_items")
        .insert(items);

      if (itemsError) {
        console.error("Failed to create request items:", itemsError);
        // The header is committed; this is a partial-success state.
        // Caller can re-PATCH to add the items. Don't roll back.
      }
    }

    await logAudit({
      actorId: authUser.id,
      actorEmail: email,
      actorRole: role,
      entityType: "part_request",
      entityId: spr.id,
      action: "created",
      newValue: requestNo,
      metadata: {
        site_id: data.site_id,
        priority: data.priority,
        ticket_id: data.ticket_id ?? null,
        item_count: data.items?.length ?? 0,
        total_cost: totalCost,
      },
    });

    return NextResponse.json({ data: spr }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Create SPR error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
