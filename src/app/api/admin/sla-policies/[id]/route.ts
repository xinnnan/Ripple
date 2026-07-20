import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logDiff } from "@/lib/audit";

export const dynamic = "force-dynamic";

const minuteField = z.number().int().nonnegative().max(525600);

const updateSLASchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
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

// PATCH /api/admin/sla-policies/[id] — edit a policy
//
// Note: customer_id is intentionally NOT editable. The relationship
// is "this customer uses this policy" — moving a policy to a
// different customer is a delete + create operation, not a PATCH,
// so we don't have to worry about a typo overwriting someone
// else's policy.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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
    const parsed = updateSLASchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.errors },
        { status: 400 }
      );
    }
    const data = parsed.data;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const before = await supabase
      .from("sla_policies")
      .select(
        "name, is_default, p1_response_minutes, p1_resolution_minutes, p2_response_minutes, p2_resolution_minutes, p3_response_minutes, p3_resolution_minutes, p4_response_minutes, p4_resolution_minutes"
      )
      .eq("id", id)
      .maybeSingle();
    if (before.error) {
      console.error("PATCH /api/admin/sla-policies/[id] before fetch failed:", before.error);
      return NextResponse.json({ error: "Failed to load policy" }, { status: 500 });
    }
    if (!before.data) {
      return NextResponse.json({ error: "SLA policy not found" }, { status: 404 });
    }

    let row;
    try {
      const result = await supabase
        .from("sla_policies")
        .update(data)
        .eq("id", id)
        .select()
        .single();
      if (result.error) throw result.error;
      row = result.data;
    } catch (e) {
      console.error("PATCH /api/admin/sla-policies/[id] update failed:", e);
      const msg = e instanceof Error ? e.message : String(e);
      if (/sla_policies_default/i.test(msg)) {
        return NextResponse.json(
          { error: "Only one default policy is allowed." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Failed to update SLA policy" }, { status: 500 });
    }

    await logDiff({
      actorId: auth.userId,
      actorEmail: auth.email,
      actorRole: auth.role,
      entityType: "sla_policy",
      entityId: id,
      before: before.data as Record<string, unknown>,
      after: data,
    });

    return NextResponse.json({ policy: row });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: e.errors },
        { status: 400 }
      );
    }
    console.error("Update SLA policy error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/admin/sla-policies/[id] — soft-delete by setting
// name to "DELETED-<timestamp>" and removing default / customer
// linkage. We don't actually DELETE — there are tickets pointing
// at this policy. The cascade on the FK is ON DELETE SET NULL,
// so we'd orphan the tickets, and there's no UI affordance to
// "re-apply" a policy.
//
// For the default policy we reject the delete — at least one
// policy must exist for new tickets to have an SLA.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const supabase = createAdminClient();
    const before = await supabase
      .from("sla_policies")
      .select("id, name, is_default, customer_id")
      .eq("id", id)
      .maybeSingle();
    if (!before.data) {
      return NextResponse.json({ error: "SLA policy not found" }, { status: 404 });
    }
    if (before.data.is_default) {
      return NextResponse.json(
        { error: "Cannot delete the default policy. Set another policy as default first." },
        { status: 400 }
      );
    }

    // Check if any tickets still reference this policy
    const { count } = await supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("sla_policy_id", id);
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete: ${count} ticket(s) still reference this policy. Re-assign or close them first.`,
        },
        { status: 409 }
      );
    }

    const { error } = await supabase
      .from("sla_policies")
      .delete()
      .eq("id", id);
    if (error) {
      console.error("DELETE /api/admin/sla-policies/[id] failed:", error);
      return NextResponse.json({ error: "Failed to delete SLA policy" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Delete SLA policy error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
