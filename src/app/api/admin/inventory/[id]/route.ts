import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import {
  inventoryIdSchema,
  inventoryPatchRequestSchema,
} from "@/lib/spare-parts/inventory-contracts";
import {
  AdminInventoryMutationError,
  applyAdminInventoryPatch,
} from "@/lib/spare-parts/inventory-mutations";

export const dynamic = "force-dynamic";

// PATCH /api/admin/inventory/[id] — Update inventory quantity / thresholds
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!inventoryIdSchema.safeParse(id).success) {
    return NextResponse.json(
      { error: "Invalid inventory id" },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = inventoryPatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }
  try {
    const inventory = await applyAdminInventoryPatch({
      supabase: createAdminClient(),
      actorId: auth.userId,
      inventoryId: id,
      patch: parsed.data,
    });
    return NextResponse.json({ data: inventory });
  } catch (error) {
    if (error instanceof AdminInventoryMutationError) {
      if (error.code === "P0002") {
        return NextResponse.json(
          { error: "Inventory record not found" },
          { status: 404 }
        );
      }
      if (error.code === "42501") {
        return NextResponse.json(
          { error: "Forbidden: Active admin access required" },
          { status: 403 }
        );
      }
      if (error.code === "55000") {
        return NextResponse.json(
          { error: "Inventory requires an active part and editable site" },
          { status: 409 }
        );
      }
      if (
        ["22003", "22023", "22P02", "23503", "23514"].includes(
          error.code ?? ""
        )
      ) {
        return NextResponse.json(
          { error: "Invalid inventory update" },
          { status: 400 }
        );
      }
    }

    console.error("PATCH /api/admin/inventory/[id] command failed:", error);
    return NextResponse.json(
      { error: "Failed to update inventory record" },
      { status: 500 }
    );
  }
}
