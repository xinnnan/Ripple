import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { slaPolicyCreateRequestSchema } from "@/lib/sla-policies/contracts";
import {
  AdminSLAPolicyMutationError,
  createAdminSLAPolicyAtomic,
} from "@/lib/sla-policies/mutations";

export const dynamic = "force-dynamic";

const POLICY_PROJECTION = `
  id,
  created_at,
  updated_at,
  name,
  customer_id,
  is_default,
  p1_response_minutes,
  p1_resolution_minutes,
  p2_response_minutes,
  p2_resolution_minutes,
  p3_response_minutes,
  p3_resolution_minutes,
  p4_response_minutes,
  p4_resolution_minutes,
  customer:customers(id, name, status)
`;

// GET /api/admin/sla-policies — list all policies
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("sla_policies")
      .select(POLICY_PROJECTION)
      .order("is_default", { ascending: false })
      .order("name");

    if (error) {
      console.error("GET /api/admin/sla-policies failed:", {
        code: error.code,
      });
      return NextResponse.json(
        { error: "Failed to fetch SLA policies" },
        { status: 500 }
      );
    }

    return NextResponse.json({ policies: data ?? [] });
  } catch (error) {
    console.error("GET /api/admin/sla-policies error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
// POST /api/admin/sla-policies — create one default or customer policy
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = slaPolicyCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }

  const customerId = parsed.data.customer_id ?? null;

  try {
    const policy = await createAdminSLAPolicyAtomic({
      supabase: createAdminClient(),
      actorId: auth.userId,
      input: {
        ...parsed.data,
        customer_id: customerId,
        is_default: customerId === null,
      },
    });

    return NextResponse.json({ policy }, { status: 201 });
  } catch (error) {
    if (error instanceof AdminSLAPolicyMutationError) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "An SLA policy already exists for this scope" },
          { status: 409 }
        );
      }
      if (error.code === "P0002") {
        return NextResponse.json(
          { error: "Customer not found or inactive" },
          { status: 400 }
        );
      }
      if (error.code === "42501") {
        return NextResponse.json(
          { error: "Forbidden: Active admin access required" },
          { status: 403 }
        );
      }
      if (
        ["22003", "22023", "22P02", "23503", "23514"].includes(
          error.code ?? ""
        )
      ) {
        return NextResponse.json(
          { error: "Invalid SLA policy" },
          { status: 400 }
        );
      }
    }

    console.error("POST /api/admin/sla-policies command failed:", error);
    return NextResponse.json(
      { error: "Failed to create SLA policy" },
      { status: 500 }
    );
  }
}
