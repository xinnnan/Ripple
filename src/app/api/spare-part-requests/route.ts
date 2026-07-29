import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireInternal } from "@/lib/supabase/auth-helpers";
import { getUserScope, scopeSiteRows } from "@/lib/supabase/scope";
import {
  createSparePartRequestAtomic,
  SparePartRequestMutationError,
} from "@/lib/spare-parts/mutations";
import { sparePartRequestForExternal } from "@/lib/resource-visibility";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const createSPRSchema = z
  .object({
    ticket_id: z.string().uuid().nullable().optional(),
    site_id: z.string().uuid(),
    priority: z.enum(PRIORITIES).default("normal"),
    notes: z.string().trim().max(5000).nullable().optional(),
    items: z
      .array(
        z.object({
          spare_part_id: z.string().uuid(),
          quantity: z.number().int().positive().max(2_147_483_647),
          unit_price: z
            .number()
            .nonnegative()
            .finite()
            .max(99_999_999.99)
            .nullable()
            .optional(),
          notes: z.string().trim().max(500).nullable().optional(),
        })
      )
      .min(1)
      .max(100),
  })
  .superRefine((value, context) => {
    const partIds = value.items.map((item) => item.spare_part_id);
    if (new Set(partIds).size !== partIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Duplicate spare parts are not allowed",
      });
    }
  });

// GET /api/spare-part-requests — List spare part requests
export async function GET(request: NextRequest) {
  try {
    const scope = await getUserScope();
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    query = scopeSiteRows(query, scope);

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

    const responseData = scope.isInternal
      ? data
      : (data || []).map((row) =>
          sparePartRequestForExternal(
            row as unknown as Record<string, unknown>
          )
        );
    return NextResponse.json({ data: responseData });
  } catch (e) {
    console.error("GET /api/spare-part-requests error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/spare-part-requests — Create a spare part request
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
    const data = createSPRSchema.parse(body);

    const { items, ...input } = data;
    const admin = createAdminClient();
    let createdRequestId: string;

    try {
      createdRequestId = await createSparePartRequestAtomic({
        supabase: admin,
        actorId: auth.userId,
        input,
        items,
      });
    } catch (error) {
      if (
        error instanceof SparePartRequestMutationError &&
        ["22003", "22023", "22P02", "23503", "23514"].includes(
          error.code ?? ""
        )
      ) {
        return NextResponse.json(
          { error: "Invalid spare part request" },
          { status: 400 }
        );
      }
      if (
        error instanceof SparePartRequestMutationError &&
        error.code === "42501"
      ) {
        return NextResponse.json(
          { error: "Forbidden: Active internal access required" },
          { status: 403 }
        );
      }
      console.error("POST /api/spare-part-requests command failed:", error);
      return NextResponse.json(
        { error: "Failed to create spare part request" },
        { status: 500 }
      );
    }

    // Hydration is intentionally outside the mutation transaction. A failed
    // read must not make the caller retry a request that already committed.
    const { data: spr, error } = await admin
      .from("spare_part_requests")
      .select(`
        *,
        site:sites(id, site_name, site_code),
        ticket:tickets(id, ticket_no, title),
        requester:users!spare_part_requests_requested_by_fkey(id, full_name),
        items:spare_part_request_items(*, spare_part:spare_parts(*))
      `)
      .eq("id", createdRequestId)
      .single();

    if (error) {
      console.error("POST /api/spare-part-requests hydration failed:", error);
      return NextResponse.json(
        {
          data: { id: createdRequestId },
          warning:
            "Request created; detail refresh is temporarily unavailable",
        },
        { status: 201 }
      );
    }

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
