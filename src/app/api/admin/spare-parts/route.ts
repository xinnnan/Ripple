import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import {
  PART_CATEGORIES,
  sparePartCreateRequestSchema,
} from "@/lib/spare-parts/admin-contracts";
import {
  AdminSparePartMutationError,
  createAdminSparePartAtomic,
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

// GET /api/admin/spare-parts — list the catalog with optional filters
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createAdminClient();
  const { searchParams } = new URL(request.url);
  let query = supabase
    .from("spare_parts")
    .select(PART_PROJECTION)
    .order("part_name");

  const category = searchParams.get("category");
  if (
    category &&
    PART_CATEGORIES.includes(
      category as (typeof PART_CATEGORIES)[number]
    )
  ) {
    query = query.eq("category", category);
  }

  if (searchParams.get("active") === "true") {
    query = query.eq("is_active", true);
  }

  const search = searchParams.get("search");
  if (search) {
    const sanitized = search
      .replace(/[%,().]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);
    if (sanitized) {
      const pattern = `%${sanitized}%`;
      query = query.or(
        `part_number.ilike.${pattern},part_name.ilike.${pattern}`
      );
    }
  }

  try {
    const { data, error } = await query;
    if (error) {
      console.error("GET /api/admin/spare-parts failed:", {
        code: error.code,
      });
      return NextResponse.json(
        { error: "Failed to fetch spare parts" },
        { status: 500 }
      );
    }
    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    console.error("GET /api/admin/spare-parts error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/admin/spare-parts — create one active catalog part
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

  const parsed = sparePartCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }

  try {
    const part = await createAdminSparePartAtomic({
      supabase: createAdminClient(),
      actorId: auth.userId,
      input: parsed.data,
    });
    return NextResponse.json({ data: part }, { status: 201 });
  } catch (error) {
    if (error instanceof AdminSparePartMutationError) {
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
          { error: "Invalid spare-part values" },
          { status: 400 }
        );
      }
    }

    console.error("POST /api/admin/spare-parts command failed:", error);
    return NextResponse.json(
      { error: "Failed to create spare part" },
      { status: 500 }
    );
  }
}
