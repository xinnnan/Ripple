import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import {
  sparePartIdSchema,
  sparePartPatchRequestSchema,
} from "@/lib/spare-parts/admin-contracts";
import {
  AdminSparePartMutationError,
  applyAdminSparePartPatch,
} from "@/lib/spare-parts/admin-mutations";

export const dynamic = "force-dynamic";

const PART_PROJECTION = `
  id,
  part_number,
  part_name,
  description,
  category,
  unit,
  unit_price,
  compatible_models,
  image_url,
  is_active,
  created_at,
  updated_at
`;

function invalidPartId() {
  return NextResponse.json(
    { error: "Invalid spare-part id" },
    { status: 400 }
  );
}

// GET /api/admin/spare-parts/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!sparePartIdSchema.safeParse(id).success) return invalidPartId();

  try {
    const { data, error } = await createAdminClient()
      .from("spare_parts")
      .select(PART_PROJECTION)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("GET /api/admin/spare-parts/[id] failed:", {
        code: error.code,
      });
      return NextResponse.json(
        { error: "Failed to fetch spare part" },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: "Spare part not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ data });
  } catch (error) {
    console.error("GET /api/admin/spare-parts/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/spare-parts/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!sparePartIdSchema.safeParse(id).success) return invalidPartId();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = sparePartPatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }

  try {
    const part = await applyAdminSparePartPatch({
      supabase: createAdminClient(),
      actorId: auth.userId,
      sparePartId: id,
      patch: parsed.data,
    });
    return NextResponse.json({ data: part });
  } catch (error) {
    if (error instanceof AdminSparePartMutationError) {
      if (error.code === "P0002") {
        return NextResponse.json(
          { error: "Spare part not found" },
          { status: 404 }
        );
      }
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "A spare part with this part number already exists" },
          { status: 409 }
        );
      }
      if (error.code === "42501") {
        return NextResponse.json(
          { error: "Forbidden: Active admin access required" },
          { status: 403 }
        );
      }
      if (
        ["22003", "22023", "22P02", "23514"].includes(error.code ?? "")
      ) {
        return NextResponse.json(
          { error: "Invalid spare-part update" },
          { status: 400 }
        );
      }
    }

    console.error("PATCH /api/admin/spare-parts/[id] command failed:", error);
    return NextResponse.json(
      { error: "Failed to update spare part" },
      { status: 500 }
    );
  }
}
