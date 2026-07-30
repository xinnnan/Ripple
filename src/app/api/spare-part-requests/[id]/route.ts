import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireInternal } from "@/lib/supabase/auth-helpers";
import { getUserScope, scopeSiteRows } from "@/lib/supabase/scope";
import {
  applySparePartRequestPatch,
  SparePartRequestMutationError,
} from "@/lib/spare-parts/mutations";
import { sparePartRequestForExternal } from "@/lib/resource-visibility";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SPR_STATUSES = ["requested", "approved", "shipped", "delivered", "cancelled"] as const;
const SPR_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const updateSPRSchema = z
  .object({
    status: z.enum(SPR_STATUSES).optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    priority: z.enum(SPR_PRIORITIES).optional(),
    shipping_carrier: z.string().trim().max(100).nullable().optional(),
    shipping_tracking: z.string().trim().max(200).nullable().optional(),
    items: z
      .array(
        z.object({
          id: z.string().uuid(),
          fulfilled_quantity: z.number().int().nonnegative(),
        })
      )
      .max(100)
      .optional(),
  })
  .superRefine((value, context) => {
    const itemIds = value.items?.map((item) => item.id) ?? [];
    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Duplicate item ids are not allowed",
      });
    }
  });

// GET /api/spare-part-requests/[id] — Get request detail
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await getUserScope();
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const admin = createAdminClient();

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
      .eq("id", id);
    query = scopeSiteRows(query, scope);
    const { data, error } = await query.maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "Spare part request not found" }, { status: 404 });
    }

    const responseData = scope.isInternal
      ? data
      : sparePartRequestForExternal(data as unknown as Record<string, unknown>);
    return NextResponse.json({ data: responseData });
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
    const auth = await requireInternal();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
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

    const { items, ...patch } = data;
    const admin = createAdminClient();
    let updatedRequestId: string;

    try {
      updatedRequestId = await applySparePartRequestPatch({
        supabase: admin,
        requestId: id,
        actorId: auth.userId,
        patch,
        items,
      });
    } catch (error) {
      if (
        error instanceof SparePartRequestMutationError &&
        error.code === "P0002"
      ) {
        return NextResponse.json(
          { error: "Spare part request not found" },
          { status: 404 }
        );
      }
      if (
        error instanceof SparePartRequestMutationError &&
        ["22023", "22P02", "23514"].includes(error.code ?? "")
      ) {
        return NextResponse.json(
          { error: "Invalid spare part request update" },
          { status: 400 }
        );
      }
      console.error("PATCH /api/spare-part-requests/[id] command failed:", error);
      return NextResponse.json(
        { error: "Failed to update spare part request" },
        { status: 500 }
      );
    }

    // Hydrate only after the transaction commits so returned item quantities
    // reflect the mutation rather than the pre-update join.
    const { data: spr, error } = await admin
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
      // The command already committed. Report success with the durable ID so
      // clients do not retry a completed mutation merely because hydration
      // failed afterward.
      console.error(
        "PATCH /api/spare-part-requests/[id] hydration failed:",
        error
      );
      return NextResponse.json({
        data: { id: updatedRequestId },
        warning: "Request updated; detail refresh is temporarily unavailable",
      });
    }

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
