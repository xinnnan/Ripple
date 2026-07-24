import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

// POST /api/admin/users/bulk-delete — delete multiple users
//
// Safety rails:
//   - The caller cannot delete themselves (would lock them out).
//   - The last remaining admin cannot be deleted (would leave
//     the system with no admin).
//
// FK behaviour: most audit fields are ON DELETE SET NULL
// (created_by, owner_id, author_id, etc. — preserves history);
// site_members and field_service_engineers cascade (the assignment
// rows go away with the user).
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
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.errors },
        { status: 400 }
      );
    }
    const { ids } = parsed.data;

    const supabase = createAdminClient();

    const failed: { id: string; reason: string }[] = [];
    const toDelete: string[] = [];

    // Block deleting yourself.
    for (const id of ids) {
      if (id === auth.userId) {
        failed.push({ id, reason: "You cannot delete your own account" });
      } else {
        toDelete.push(id);
      }
    }

    // Count remaining admins after the delete. The caller is
    // always an admin (requireAdmin() above), so the system
    // always has at least 1 admin (the caller) surviving — the
    // "last admin" guard only fires if EVERY other admin is
    // also in the delete list. We refuse that scenario so the
    // operator can't accidentally reduce the org to a single
    // admin (themselves) without explicitly meaning to.
    //
    // (We considered the stricter "surviving <= 0" check, but
    // that never fires for an admin caller — the caller is
    // always an admin, so they always count as a survivor. The
    // check below is the right level of paranoia: refuse to
    // remove every other admin in a single click.)
    const { data: remainingAdmins } = await supabase
      .from("users")
      .select("id, role")
      .in("role", ["admin"]);
    const adminIds = new Set((remainingAdmins || []).map((u) => u.id as string));
    const targetAdminIds = toDelete.filter((id) => adminIds.has(id));
    const otherAdminCount = adminIds.size - 1; // minus the caller
    if (otherAdminCount > 0 && targetAdminIds.length >= otherAdminCount) {
      // We're about to remove every other admin. Refuse all
      // the target admin ids (the caller survives; this keeps
      // at least one peer admin).
      for (const id of targetAdminIds) {
        failed.push({ id, reason: "Cannot delete the last admin" });
      }
    }

    // After pre-checks, filter `toDelete` to exclude the failed ones.
    const failedSet = new Set(failed.map((f) => f.id));
    const actuallyDelete = toDelete.filter((id) => !failedSet.has(id));

    let deletedCount = 0;
    for (const id of actuallyDelete) {
      // public.users is the source of truth. Verify the row
      // exists before trying to delete (a non-existent uuid
      // would otherwise silently increment deletedCount).
      const { data: existing, error: lookupErr } = await supabase
        .from("users")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      if (lookupErr) {
        failed.push({ id, reason: `lookup: ${lookupErr.message}` });
        continue;
      }
      if (!existing) {
        failed.push({ id, reason: "User not found" });
        continue;
      }
      // Delete from public.users first (the FK on auth.users.id
      // is the only reference that holds; auth.admin.deleteUser
      // will then remove the auth row).
      const { error: dbError } = await supabase.from("users").delete().eq("id", id);
      if (dbError) {
        failed.push({ id, reason: `public.users delete: ${dbError.message}` });
        continue;
      }
      const { error: authError } = await supabase.auth.admin.deleteUser(id);
      if (authError) {
        // public.users row is already gone; auth row remains. Log
        // and move on so the operator can clean up later.
        failed.push({ id, reason: `auth.admin.deleteUser: ${authError.message} (public.users already deleted)` });
      }
      await logAudit({
        actorId: auth.userId,
        actorEmail: auth.email,
        actorRole: auth.role,
        entityType: "user",
        entityId: id,
        action: "deleted",
        metadata: { source: "bulk-delete" },
      });
      deletedCount++;
    }

    return NextResponse.json({
      deleted: deletedCount,
      failed,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Bulk delete users error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
