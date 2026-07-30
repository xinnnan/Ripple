import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireInternal } from "@/lib/supabase/auth-helpers";
import { getUserScope, scopeSiteRows } from "@/lib/supabase/scope";
import { updateFieldServiceOrderSchema } from "@/lib/field-service/contracts";
import {
  applyFieldServiceOrderPatch,
  FieldServiceOrderMutationError,
} from "@/lib/field-service/mutations";
import { fieldServiceOrderForExternal } from "@/lib/resource-visibility";
import { z } from "zod";

export const dynamic = "force-dynamic";

// GET /api/field-service-orders/[id] — Get order detail
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
      .from("field_service_orders")
      .select(`
        *,
        site:sites(id, site_name, site_code),
        ticket:tickets(id, ticket_no, title),
        requester:users!field_service_orders_requested_by_fkey(id, full_name),
        completer:users!field_service_orders_completed_by_fkey(id, full_name),
        engineers:field_service_engineers(*, engineer:users(id, full_name, email))
      `)
      .eq("id", id);
    query = scopeSiteRows(query, scope);
    const { data, error } = await query.maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "Field service order not found" }, { status: 404 });
    }

    const responseData = scope.isInternal
      ? data
      : fieldServiceOrderForExternal(data as unknown as Record<string, unknown>);
    return NextResponse.json({ data: responseData });
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
    const data = updateFieldServiceOrderSchema.parse(body);

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { engineers, ...patch } = data;
    const admin = createAdminClient();
    let updatedOrderId: string;

    try {
      updatedOrderId = await applyFieldServiceOrderPatch({
        supabase: admin,
        orderId: id,
        actorId: auth.userId,
        patch,
        engineers,
      });
    } catch (error) {
      if (
        error instanceof FieldServiceOrderMutationError &&
        error.code === "P0002"
      ) {
        return NextResponse.json(
          { error: "Field service order not found" },
          { status: 404 }
        );
      }
      if (
        error instanceof FieldServiceOrderMutationError &&
        ["22003", "22007", "22008", "22023", "22P02", "23503", "23505", "23514"].includes(
          error.code ?? ""
        )
      ) {
        return NextResponse.json(
          { error: "Invalid field service order update" },
          { status: 400 }
        );
      }
      if (
        error instanceof FieldServiceOrderMutationError &&
        error.code === "42501"
      ) {
        return NextResponse.json(
          { error: "Forbidden: Active internal access required" },
          { status: 403 }
        );
      }
      console.error(
        "PATCH /api/field-service-orders/[id] command failed:",
        error
      );
      return NextResponse.json(
        { error: "Failed to update field service order" },
        { status: 500 }
      );
    }

    // Hydrate only after the command commits so returned engineers always
    // reflect the post-replacement assignment set.
    const { data: order, error } = await admin
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
      console.error(
        "PATCH /api/field-service-orders/[id] hydration failed:",
        error
      );
      return NextResponse.json({
        data: { id: updatedOrderId },
        warning:
          "Service order updated; detail refresh is temporarily unavailable",
      });
    }

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
