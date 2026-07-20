import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const PART_CATEGORIES = [
  "sensor", "motor", "controller", "belt", "roller", "cable",
  "connector", "battery", "pcb", "mechanical", "safety", "tool", "other",
] as const;

const PART_UNITS = ["piece", "set", "meter", "kg", "liter", "roll"] as const;

const partInputSchema = z.object({
  part_number: z.string().trim().min(1).max(100),
  part_name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  category: z.enum(PART_CATEGORIES).default("other"),
  unit: z.enum(PART_UNITS).default("piece"),
  unit_price: z.number().nonnegative().finite().nullable().optional(),
  compatible_models: z.array(z.string().trim().min(1).max(100)).max(50).nullable().optional(),
  image_url: z.string().url().max(2000).nullable().optional(),
});

const partPatchSchema = partInputSchema.partial().extend({
  is_active: z.boolean().optional(),
});

// GET /api/admin/spare-parts — List all spare parts (with optional filters)
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createAdminClient();
  const { searchParams } = new URL(request.url);

  let query = supabase
    .from("spare_parts")
    .select("*")
    .order("part_name");

  const category = searchParams.get("category");
  if (category) query = query.eq("category", category);

  const activeOnly = searchParams.get("active");
  if (activeOnly === "true") query = query.eq("is_active", true);

  const search = searchParams.get("search");
  if (search) {
    // Strip all PostgREST or-filter metacharacters (comma, parens,
    // percent, dot) so a search like "x,part_number.eq.42" can't
    // inject an extra filter condition. The trimmed, max-100-char
    // value is the only thing that ends up in the or() pattern.
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

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// POST /api/admin/spare-parts — Create a new spare part
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

  const parsed = partInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const supabase = createAdminClient();

  let row;
  try {
    const result = await supabase
      .from("spare_parts")
      .insert({
        part_number: data.part_number,
        part_name: data.part_name,
        description: data.description ?? null,
        category: data.category,
        unit: data.unit,
        unit_price: data.unit_price ?? null,
        compatible_models: data.compatible_models ?? null,
        image_url: data.image_url ?? null,
        is_active: true,
      })
      .select()
      .single();
    if (result.error) throw result.error;
    row = result.data;
  } catch (e) {
    console.error("POST /api/admin/spare-parts insert failed:", e);
    return NextResponse.json(
      { error: "Failed to create spare part" },
      { status: 500 }
    );
  }

  await logAudit({
    actorId: auth.userId,
    actorEmail: auth.email,
    actorRole: auth.role,
    entityType: "spare_part",
    entityId: row?.id ?? null,
    action: "created",
    newValue: data.part_number,
    metadata: { part_name: data.part_name, category: data.category },
  });

  return NextResponse.json({ data: row }, { status: 201 });
}
