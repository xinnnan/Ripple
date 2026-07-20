import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const minuteField = z.number().int().nonnegative().max(525600);

// Per-severity response + resolution minutes. P1..P4 are all
// required for new policies; for PATCH they're all optional.
// The `name` and `customer_id` distinguish "default" (customer_id
// null, is_default true) from "per-customer override".
const slaPolicyInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  customer_id: z.string().uuid().nullable().optional(),
  is_default: z.boolean().optional(),
  p1_response_minutes: minuteField.optional(),
  p1_resolution_minutes: minuteField.optional(),
  p2_response_minutes: minuteField.optional(),
  p2_resolution_minutes: minuteField.optional(),
  p3_response_minutes: minuteField.optional(),
  p3_resolution_minutes: minuteField.optional(),
  p4_response_minutes: minuteField.optional(),
  p4_resolution_minutes: minuteField.optional(),
});

// Required shape for a brand-new policy (no defaults allowed for
// the per-severity minutes — we want the operator to think about
// each one).
const slaPolicyCreateSchema = slaPolicyInputSchema.extend({
  p1_response_minutes: minuteField,
  p1_resolution_minutes: minuteField,
  p2_response_minutes: minuteField,
  p2_resolution_minutes: minuteField,
  p3_response_minutes: minuteField,
  p3_resolution_minutes: minuteField,
  p4_response_minutes: minuteField,
  p4_resolution_minutes: minuteField,
  is_default: z.boolean().default(false),
});

// GET /api/admin/sla-policies — list all policies
export async function GET() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("sla_policies")
      .select(
        `
        *,
        customer:customers(id, name)
      `
      )
      .order("is_default", { ascending: false })
      .order("name");

    if (error) {
      console.error("GET /api/admin/sla-policies failed:", error);
      return NextResponse.json({ error: "Failed to fetch SLA policies" }, { status: 500 });
    }
    return NextResponse.json({ policies: data });
  } catch (e) {
    console.error("GET /api/admin/sla-policies error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/admin/sla-policies — create a new policy
export async function POST(request: NextRequest) {
  try {
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
    const parsed = slaPolicyCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.errors },
        { status: 400 }
      );
    }
    const data = parsed.data;

    // Validate the customer_id exists (if set). Otherwise we'd
    // be able to insert a policy pointing at a phantom customer.
    if (data.customer_id) {
      const supabase = createAdminClient();
      const { data: cust } = await supabase
        .from("customers")
        .select("id")
        .eq("id", data.customer_id)
        .maybeSingle();
      if (!cust) {
        return NextResponse.json(
          { error: "customer_id not found" },
          { status: 400 }
        );
      }
    }

    const supabase = createAdminClient();
    let row;
    try {
      const result = await supabase
        .from("sla_policies")
        .insert({
          name: data.name,
          customer_id: data.customer_id ?? null,
          is_default: data.is_default,
          p1_response_minutes: data.p1_response_minutes,
          p1_resolution_minutes: data.p1_resolution_minutes,
          p2_response_minutes: data.p2_response_minutes,
          p2_resolution_minutes: data.p2_resolution_minutes,
          p3_response_minutes: data.p3_response_minutes,
          p3_resolution_minutes: data.p3_resolution_minutes,
          p4_response_minutes: data.p4_response_minutes,
          p4_resolution_minutes: data.p4_resolution_minutes,
        })
        .select()
        .single();
      if (result.error) throw result.error;
      row = result.data;
    } catch (e) {
      console.error("POST /api/admin/sla-policies insert failed:", e);
      const msg = e instanceof Error ? e.message : String(e);
      if (/sla_policies_default|sla_policies_customer/i.test(msg)) {
        return NextResponse.json(
          { error: "Only one default policy is allowed, and each customer can have at most one policy." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Failed to create SLA policy" }, { status: 500 });
    }

    await logAudit({
      actorId: auth.userId,
      actorEmail: auth.email,
      actorRole: auth.role,
      entityType: "sla_policy",
      entityId: row.id,
      action: "created",
      newValue: data.name,
      metadata: {
        is_default: data.is_default,
        customer_id: data.customer_id ?? null,
      },
    });

    return NextResponse.json({ policy: row }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: e.errors },
        { status: 400 }
      );
    }
    console.error("Create SLA policy error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
