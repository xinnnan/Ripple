import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logDiff, logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

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
    const { full_name, role, status } = body;

    const updates: Record<string, string> = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (role !== undefined) updates.role = role;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Fetch before-state for the audit diff
    const { data: before } = await supabase
      .from("users")
      .select("full_name, role, status")
      .eq("id", id)
      .single();

    const { error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Role change is security-relevant — log it explicitly even if
    // logDiff also picks it up.
    if (role && before?.role && role !== before.role) {
      await logAudit({
        actorId: auth.userId,
        actorRole: auth.role,
        entityType: "user",
        entityId: id,
        action: "role_changed",
        fieldName: "role",
        oldValue: before.role,
        newValue: role,
        metadata: { target_email: (before as unknown as { email?: string })?.email },
      });
    }

    await logDiff({
      actorId: auth.userId,
      actorRole: auth.role,
      entityType: "user",
      entityId: id,
      before,
      after: updates,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
