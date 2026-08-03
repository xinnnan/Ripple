import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireInternal } from "@/lib/supabase/auth-helpers";
import { getUserScope, scopeSiteRows } from "@/lib/supabase/scope";
import { createFieldServiceOrderSchema } from "@/lib/field-service/contracts";
import {
  createFieldServiceOrderAtomic,
  FieldServiceOrderMutationError,
} from "@/lib/field-service/mutations";
import { fieldServiceOrderForExternal } from "@/lib/resource-visibility";
import { z } from "zod";
import {
  EXTERNAL_FIELD_SERVICE_ORDER_SELECT,
  INTERNAL_FIELD_SERVICE_ORDER_SELECT,
} from "@/lib/resource-projections";
import { parseFieldServiceOrderListFilters } from "@/lib/resource-list-filters";

export const dynamic = "force-dynamic";

// GET /api/field-service-orders — List field service orders
export async function GET(request: NextRequest) {
  try {
    const scope = await getUserScope();
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsedFilters = parseFieldServiceOrderListFilters(searchParams);
    if (!parsedFilters.success) {
      return NextResponse.json(
        { error: "Invalid field service order filters" },
        { status: 400 }
      );
    }
    const filters = parsedFilters.data;
    if (
      filters.siteId &&
      !scope.isInternal &&
      !scope.siteIds.includes(filters.siteId)
    ) {
      return NextResponse.json(
        { error: "Forbidden: site is outside your scope" },
        { status: 403 }
      );
    }

    const admin = createAdminClient();

    const orderSelect: string = scope.isInternal
      ? INTERNAL_FIELD_SERVICE_ORDER_SELECT
      : EXTERNAL_FIELD_SERVICE_ORDER_SELECT;
    let query = admin
      .from("field_service_orders")
      .select(orderSelect)
      .order("created_at", { ascending: false });

    query = scopeSiteRows(query, scope);

    // Filters
    if (filters.status) query = query.eq("status", filters.status);

    if (filters.siteId) query = query.eq("site_id", filters.siteId);

    if (filters.ticketId) query = query.eq("ticket_id", filters.ticketId);

    if (filters.serviceType) {
      query = query.eq("service_type", filters.serviceType);
    }

    const { data, error } = await query;

    if (error) {
      console.error("GET /api/field-service-orders failed:", {
        code: (error as { code?: string }).code,
      });
      return NextResponse.json({ error: "Failed to fetch field service orders" }, { status: 500 });
    }

    const responseData = scope.isInternal
      ? data
      : (data || []).map((row) =>
          fieldServiceOrderForExternal(
            row as unknown as Record<string, unknown>
          )
        );
    return NextResponse.json(
      { data: responseData },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    console.error("GET /api/field-service-orders error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/field-service-orders — Create a field service order
export async function POST(request: NextRequest) {
  try {
    const auth = await requireInternal();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const data = createFieldServiceOrderSchema.parse(body);

    const { engineers, ...input } = data;
    const admin = createAdminClient();
    let createdOrderId: string;

    try {
      createdOrderId = await createFieldServiceOrderAtomic({
        supabase: admin,
        actorId: auth.userId,
        input,
        engineers,
      });
    } catch (error) {
      if (
        error instanceof FieldServiceOrderMutationError &&
        ["22003", "22007", "22008", "22023", "22P02", "23503", "23505", "23514"].includes(
          error.code ?? ""
        )
      ) {
        return NextResponse.json(
          { error: "Invalid field service order" },
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
      console.error("POST /api/field-service-orders command failed:", error);
      return NextResponse.json(
        { error: "Failed to create field service order" },
        { status: 500 }
      );
    }

    // Hydrate after commit so a read failure cannot make the caller retry a
    // field-service order that was already created successfully.
    const { data: order, error } = await admin
      .from("field_service_orders")
      .select(`
        *,
        site:sites(id, site_name, site_code),
        ticket:tickets(id, ticket_no, title),
        requester:users!field_service_orders_requested_by_fkey(id, full_name),
        engineers:field_service_engineers(*, engineer:users(id, full_name, email))
      `)
      .eq("id", createdOrderId)
      .single();

    if (error) {
      console.error("POST /api/field-service-orders hydration failed:", error);
      return NextResponse.json(
        {
          data: { id: createdOrderId },
          warning:
            "Service order created; detail refresh is temporarily unavailable",
        },
        { status: 201 }
      );
    }

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
