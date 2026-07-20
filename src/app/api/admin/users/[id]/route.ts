import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logDiff, logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const updateUserSchema = z.object({
  full_name: z.string().trim().min(1).max(200).optional(),
  role: z.enum(["admin", "engineer", "customer_manager", "customer"]).optional(),
  status: z.enum(["active", "inactive", "invited"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const data = updateUserSchema.parse(body);

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Fetch before-state for the audit diff
    const { data: before } = await supabase
      .from("users")
      .select("full_name, role, status, email")
      .eq("id", id)
      .single();

    const { error } = await supabase
      .from("users")
      .update(data)
      .eq("id", id);

    if (error) {
      console.error("PATCH /api/admin/users/[id] failed:", error);
      return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
    }

    // Role change is security-relevant — log it explicitly even if
    // logDiff also picks it up.
    if (data.role && before?.role && data.role !== before.role) {
      await logAudit({
        actorId: auth.userId,
        actorEmail: auth.email,
        actorRole: auth.role,
        entityType: "user",
        entityId: id,
        action: "role_changed",
        fieldName: "role",
        oldValue: before.role,
        newValue: data.role,
        metadata: { target_email: before.email },
      });
    }

    await logDiff({
      actorId: auth.userId,
      actorEmail: auth.email,
      actorRole: auth.role,
      entityType: "user",
      entityId: id,
      before,
      after: data,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
